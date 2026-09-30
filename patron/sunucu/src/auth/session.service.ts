// BULUT GİRİŞİ — tek adım: e-posta + parola + TOTP (TOTP ZORUNLU; TOTP'siz oturum YOKTUR — DB CHECK
// da AKTİF hesabı TOTP'siz doğurmaz). Hata iletisi tek (hangi faktörün tutmadığı söylenmez);
// bilinmeyen/uygun olmayan hesapta eşdeğer scrypt işi harcanır; ardışık başarısızlık süreli kilit.
// Oturum belirteci düz saklanmaz (sha256); taşıma `Authorization: Bearer`.
// Kiracı girişte e-postadan çözülür (ön-kiracı arama), sonraki her iş o tesisin kapsamında koşar.
import { createHash, randomBytes } from "node:crypto";
import type { Account } from "@prisma/client";
import { effectivePermissions, type CloudPermission } from "../catalog/permissions";
import { readableProjections } from "../catalog/projections";
import { readableReportProjections } from "../catalog/reports";
import { accountActor, recordAudit } from "../lib/audit";
import { CloudError } from "../lib/errors";
import { withLookup, withTesis } from "../lib/tenant";
import type { CloudContext } from "../services/context";
import { loadServiceFacts, serviceState } from "../services/service-lifecycle";
import { assertPasswordStrength, burnPasswordCheck, hashPassword, verifyPassword } from "./password";
import { verifyTotp } from "./totp";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOUCH_INTERVAL_MS = 60_000;

export interface SessionContext {
  readonly sessionId: string;
  readonly tesisId: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly email: string;
  readonly permissions: ReadonlySet<CloudPermission>;
  /** RLS alan izni: hesabın okuyabileceği projeksiyon adları (rapor sonuçları dahil). */
  readonly projections: readonly string[];
}

export function normalizeEmail(email: string): string {
  return email.normalize("NFC").trim().toLowerCase();
}

export function tokenDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newToken(): { token: string; digest: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, digest: tokenDigest(token) };
}

export function sessionProjections(permissions: ReadonlySet<CloudPermission>): string[] {
  return [...readableProjections(permissions), ...readableReportProjections(permissions)];
}

const loginFailed = (): CloudError => new CloudError(401, "GIRIS_BASARISIZ", "E-posta, parola ya da doğrulama kodu hatalı");

async function registerFailure(ctx: CloudContext, account: Account, nowMs: number): Promise<void> {
  const locked = await withTesis(ctx.app, { tesisId: account.tesisId }, async (tx) => {
    const bumped = await tx.account.update({ where: { id: account.id }, data: { failedLogins: { increment: 1 } }, select: { failedLogins: true } });
    if (bumped.failedLogins < ctx.config.GIRIS_ESIGI) return null;
    const until = new Date(nowMs + ctx.config.KILIT_DK * 60_000);
    const r = await tx.account.updateMany({ where: { id: account.id, failedLogins: { gte: ctx.config.GIRIS_ESIGI } }, data: { lockedUntil: until, failedLogins: 0 } });
    return r.count > 0 ? until : null;
  });
  await recordAudit(ctx.app, { tesisId: account.tesisId, actor: "giris", event: "GIRIS_BASARISIZ", entity: "Account", entityId: account.id });
  if (locked) await recordAudit(ctx.app, { tesisId: account.tesisId, actor: "giris", event: "HESAP_GECICI_KILIT", entity: "Account", entityId: account.id, summary: { bitis: locked.toISOString() } });
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly totp: string;
  readonly client: "mobil" | "web" | null;
}

export async function login(ctx: CloudContext, g: LoginInput): Promise<{ token: string; session: SessionContext; expiresAt: Date }> {
  const nowMs = ctx.now();
  const email = normalizeEmail(g.email);
  const account = email ? await withLookup(ctx.app, { kind: "eposta", value: email }, (tx) => tx.account.findUnique({ where: { email } })) : null;
  if (!account || account.status !== "AKTIF" || !account.passwordHash || !account.totpSecretSealed) {
    await burnPasswordCheck(g.password);
    if (account) await recordAudit(ctx.app, { tesisId: account.tesisId, actor: "giris", event: "GIRIS_REDDEDILDI", entity: "Account", entityId: account.id, summary: { durum: account.status } });
    throw loginFailed();
  }
  if (account.lockedUntil && account.lockedUntil.getTime() > nowMs) {
    const minutes = Math.ceil((account.lockedUntil.getTime() - nowMs) / 60_000);
    throw new CloudError(429, "GIRIS_KILITLI", `Çok sayıda hatalı deneme: hesap ${minutes} dakika kilitli`);
  }
  const passwordOk = await verifyPassword(g.password, account.passwordHash);
  const secret = ctx.secrets.open(account.totpSecretSealed, account.id);
  if (secret === null) {
    console.error(`[patron] hesap ${account.id}: TOTP sırrı çözülemedi (sır anahtarı değişmiş olabilir — hesap davetle sıfırlanmalı)`);
    throw new CloudError(500, "SUNUCU_HATASI", "Doğrulama kodu denetlenemedi; tesis yöneticinize başvurun");
  }
  const totp = verifyTotp(secret, g.totp, { atMs: nowMs, lastUsedStep: account.totpLastStep });
  if (!passwordOk || !totp.ok) {
    await registerFailure(ctx, account, nowMs);
    throw loginFailed();
  }
  const { token, digest } = newToken();
  const expiresAt = new Date(nowMs + ctx.config.OTURUM_AZAMI_GUN * 86_400_000);
  const session = await withTesis(ctx.app, { tesisId: account.tesisId }, async (tx) => {
    const facts = await loadServiceFacts(tx, account.tesisId);
    if (!facts) return null;
    // Hizmet bitince 90 gün salt okuma (giriş AÇIK); süre dolunca giriş kapanır (Ek-6/A §4.2).
    if (serviceState(facts, nowMs).phase === "KAPALI") return "KAPALI" as const;
    // Adım iddiası atomik: aynı kodla eşzamanlı iki giriş ikisi de geçemez.
    const claim = await tx.account.updateMany({
      where: { id: account.id, status: "AKTIF", OR: [{ totpLastStep: null }, { totpLastStep: { lt: totp.step } }] },
      data: { totpLastStep: totp.step, failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(nowMs) },
    });
    if (claim.count === 0) return null;
    return tx.session.create({
      data: { tesisId: account.tesisId, accountId: account.id, tokenHash: digest, client: g.client, lastUsedAt: new Date(nowMs), expiresAt },
    });
  });
  if (session === "KAPALI") throw new CloudError(403, "HIZMET_KAPANDI", "Patron bulutu hizmeti sona erdi ve salt okuma süresi doldu; veriler imha sürecinde");
  if (!session) {
    await registerFailure(ctx, account, nowMs);
    throw loginFailed();
  }
  await recordAudit(ctx.app, { tesisId: account.tesisId, actor: accountActor(account.id), event: "GIRIS", entity: "Account", entityId: account.id, summary: { oturumId: session.id, istemci: g.client } });
  const permissions = effectivePermissions(account.permissions);
  return {
    token,
    expiresAt,
    session: {
      sessionId: session.id,
      tesisId: account.tesisId,
      accountId: account.id,
      accountName: account.name,
      email: account.email,
      permissions,
      projections: sessionProjections(permissions),
    },
  };
}

/** Bearer belirtecinden oturum: kapalı · süresi dolmuş · hesap AKTİF değil · hizmet KAPALI (90 gün doldu) → null. */
export async function resolveSession(ctx: CloudContext, token: string | undefined): Promise<SessionContext | null> {
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const nowMs = ctx.now();
  const digest = tokenDigest(token);
  const row = await withLookup(ctx.app, { kind: "oturum", value: digest }, (tx) => tx.session.findUnique({ where: { tokenHash: digest } }));
  if (!row || row.closedAt) return null;
  return withTesis(ctx.app, { tesisId: row.tesisId }, async (tx) => {
    const idleLimit = row.lastUsedAt.getTime() + ctx.config.OTURUM_BOSTA_SAAT * 3_600_000;
    if (row.expiresAt.getTime() <= nowMs || idleLimit <= nowMs) {
      await tx.session.updateMany({ where: { id: row.id, closedAt: null }, data: { closedAt: new Date(nowMs), closeReason: "SURE_DOLDU" } });
      return null;
    }
    const account = await tx.account.findUnique({ where: { id: row.accountId } });
    if (!account || account.status !== "AKTIF") return null;
    const facts = await loadServiceFacts(tx, row.tesisId);
    if (!facts || serviceState(facts, nowMs).phase === "KAPALI") return null;
    if (nowMs - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      await tx.session.updateMany({ where: { id: row.id, closedAt: null }, data: { lastUsedAt: new Date(nowMs) } });
    }
    const permissions = effectivePermissions(account.permissions);
    return {
      sessionId: row.id,
      tesisId: row.tesisId,
      accountId: account.id,
      accountName: account.name,
      email: account.email,
      permissions,
      projections: sessionProjections(permissions),
    };
  });
}

export async function logout(ctx: CloudContext, s: SessionContext): Promise<void> {
  const closed = await withTesis(ctx.app, { tesisId: s.tesisId }, (tx) =>
    tx.session.updateMany({ where: { id: s.sessionId, closedAt: null }, data: { closedAt: new Date(ctx.now()), closeReason: "CIKIS" } }),
  );
  if (closed.count > 0) await recordAudit(ctx.app, { tesisId: s.tesisId, actor: accountActor(s.accountId), event: "CIKIS", entity: "Account", entityId: s.accountId });
}

/** Kendi parolasını değiştirme: mevcut parola + TOTP; öteki oturumlar kapanır. */
export async function changeOwnPassword(ctx: CloudContext, s: SessionContext, g: { current: string; next: string; totp: string }): Promise<void> {
  assertPasswordStrength(g.next);
  const nowMs = ctx.now();
  const account = await withTesis(ctx.app, { tesisId: s.tesisId }, (tx) => tx.account.findUnique({ where: { id: s.accountId } }));
  if (!account?.passwordHash || !account.totpSecretSealed) throw new CloudError(401, "OTURUM_YOK", "Oturum geçersiz");
  const secret = ctx.secrets.open(account.totpSecretSealed, account.id);
  const totp = secret ? verifyTotp(secret, g.totp, { atMs: nowMs, lastUsedStep: account.totpLastStep }) : null;
  if (!(await verifyPassword(g.current, account.passwordHash)) || !totp?.ok) {
    await registerFailure(ctx, account, nowMs);
    throw new CloudError(400, "GIRIS_BASARISIZ", "Mevcut parola ya da doğrulama kodu hatalı");
  }
  const hash = await hashPassword(g.next);
  await withTesis(ctx.app, { tesisId: s.tesisId }, async (tx) => {
    const r = await tx.account.updateMany({
      where: { id: s.accountId, status: "AKTIF", OR: [{ totpLastStep: null }, { totpLastStep: { lt: totp.step } }] },
      data: { passwordHash: hash, totpLastStep: totp.step },
    });
    if (r.count === 0) throw new CloudError(400, "GIRIS_BASARISIZ", "Mevcut parola ya da doğrulama kodu hatalı");
    await tx.session.updateMany({ where: { accountId: s.accountId, closedAt: null, id: { not: s.sessionId } }, data: { closedAt: new Date(nowMs), closeReason: "SIFIRLAMA" } });
  });
  await recordAudit(ctx.app, { tesisId: s.tesisId, actor: accountActor(s.accountId), event: "PAROLA_DEGISTI", entity: "Account", entityId: s.accountId });
}

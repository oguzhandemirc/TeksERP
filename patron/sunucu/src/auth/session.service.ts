// BULUT GİRİŞİ — tek adım: e-posta + parola + TOTP (TOTP ZORUNLU; TOTP'siz oturum YOKTUR — DB CHECK da AKTİF
// kimliği TOTP'siz doğurmaz). Faktörler merkez KİMLİKTE (`identities`), oturum TESİS başına (belirteç öneki tesis).
// Hata yanıtı TEK (401, aynı ileti) — bilinmeyen kimlik, etkin üyeliği olmayan kimlik, yanlış faktör ve kilit ayırt
// edilmez; her başarısız dal tek scrypt işi harcar ve yanıt süre tabanına bekletilir. Kilit kimlik + kaynak ikilisine
// bağlıdır (`login-throttle.ts`). Tesis değişimi (`switchFacility`) mevcut oturumla, TOTP sormadan, ömrü UZATMADAN.
import { createHash, randomBytes } from "node:crypto";
import type { Account } from "@prisma/client";
import type { FacilityChoice } from "../wire/api";
import { effectivePermissions, type CloudPermission } from "../catalog/permissions";
import { readableProjections } from "../catalog/projections";
import { readableReportProjections } from "../catalog/reports";
import { accountActor, recordAudit } from "../lib/audit";
import { CloudError } from "../lib/errors";
import { withCentral, withLookup, withTesis } from "../lib/tenant";
import type { CloudContext } from "../services/context";
import { loadServiceFacts, serviceState } from "../services/service-lifecycle";
import { activeMembershipIn, activeMemberships, closeIdentitySessions, identityByEmail, lockedMembership, membershipRoute, type ActiveMembership, type MembershipRoute } from "./membership";
import { loginThrottleFor } from "./login-throttle";
import { assertPasswordStrength, burnPasswordCheck, hashPassword, verifyPassword } from "./password";
import { verifyTotp } from "./totp";

/** Oturum/davet belirteci: `<tesis kimliği 22 hane base64url>.<rastgele 43>`; özet belirtecin TAMAMINDAN. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;
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
  /** Merkez kimliği (AKTİF hesapta DB CHECK'le dolu). */
  readonly identityId: string | null;
  /** Oturumun azami ömrü: tesis geçişi bunu devralır, uzatmaz. */
  readonly expiresAt: Date;
}

export function normalizeEmail(email: string): string {
  return email.normalize("NFC").trim().toLowerCase();
}

export function tokenDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Belirteç ön eki tesisi taşır: istek doğru tesis DB'sine yönlenir; ön eki değiştirilmiş belirteç hiçbir satırla eşleşmez. */
export function newToken(tesisId: string): { token: string; digest: string } {
  const prefix = Buffer.from(tesisId.replace(/-/g, ""), "hex").toString("base64url");
  if (prefix.length !== 22) throw new Error("Belirteç ön eki için tesis kimliği UUID olmalı");
  const token = `${prefix}.${randomBytes(32).toString("base64url")}`;
  return { token, digest: tokenDigest(token) };
}

/** Belirtecin tesis kimliği (biçimsizse null). */
export function tokenTesis(token: string): string | null {
  if (!TOKEN_PATTERN.test(token)) return null;
  const hex = Buffer.from(token.slice(0, 22), "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function sessionProjections(permissions: ReadonlySet<CloudPermission>): string[] {
  return [...readableProjections(permissions), ...readableReportProjections(permissions)];
}

const loginFailed = (): CloudError => new CloudError(401, "GIRIS_BASARISIZ", "E-posta, parola ya da doğrulama kodu hatalı");
const serviceClosed = (): CloudError => new CloudError(403, "HIZMET_KAPANDI", "Patron bulutu hizmeti sona erdi ve salt okuma süresi doldu; veriler imha sürecinde");
const switchDenied = (): CloudError => new CloudError(403, "TESIS_GECISI_YOK", "Bu tesise geçiş yapılamıyor");

/** Başarısız girişin en kısa yanıt süresi (gerçek saat): DB'ye yazan dal ile yazmayan dal süreden ayırt edilmesin. */
export const LOGIN_FAILURE_FLOOR_MS = 500;

export async function failAfterFloor(startedMs: number): Promise<never> {
  const wait = LOGIN_FAILURE_FLOOR_MS - (Date.now() - startedMs);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  throw loginFailed();
}

/** Giriş olayının istemci adresi — hesap güvenlik kaydına girer, 30 gün sonra alan silinir (`maintenance.ts` `AGED_FIELDS`). */
export const ipSummary = (ip: string | null): { ip?: string } => (ip && ip !== "?" ? { ip: ip.slice(0, 64) } : {});

/** Sayaç kimlik + kaynak; ayak izi girişin hedeflediği tesisin hesabına (üyelik yoksa ayak izi yok). */
async function registerFailure(ctx: CloudContext, identityId: string, target: MembershipRoute | undefined, g: { nowMs: number; ip: string | null }): Promise<void> {
  const { nowMs, ip } = g;
  const locked = loginThrottleFor(ctx).registerFailure(identityId, ip, nowMs);
  if (!target) return;
  await recordAudit(ctx.app, { tesisId: target.tesisId, actor: "giris", event: "GIRIS_BASARISIZ", entity: "Account", entityId: target.accountId, summary: ipSummary(ip) });
  if (locked) await recordAudit(ctx.app, { tesisId: target.tesisId, actor: "giris", event: "HESAP_GECICI_KILIT", entity: "Account", entityId: target.accountId, summary: { bitis: locked.toISOString(), kapsam: "KAYNAK", ...ipSummary(ip) } });
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly totp: string;
  readonly client: "mobil" | "web" | null;
  /** İstemci adresi (vekil başlığı ya da soket); güvenlik kaydına 30 gün girer. */
  readonly ip: string | null;
  /** Tesis ipucu (son seçilen); üyelik değilse ya da hizmeti KAPALI ise ada göre ilk açık tesis. */
  readonly tesisId?: string;
}

export interface OpenedSession {
  readonly token: string;
  readonly session: SessionContext;
  readonly expiresAt: Date;
  readonly facilities: FacilityChoice[];
}

const choices = (ms: readonly ActiveMembership[]): FacilityChoice[] => ms.map((m) => ({ id: m.tesisId, ad: m.ad, hizmet: m.hizmet }));

function contextOf(account: Account, sessionId: string, expiresAt: Date): SessionContext {
  const permissions = effectivePermissions(account.permissions);
  return {
    sessionId,
    tesisId: account.tesisId,
    accountId: account.id,
    accountName: account.name,
    email: account.email,
    permissions,
    projections: sessionProjections(permissions),
    identityId: account.identityId,
    expiresAt,
  };
}

/** Üyelik tesisinde oturum: hizmet KAPALI → "KAPALI"; hesap bu arada etkinlikten/kimlikten çıktıysa null (atomik claim). */
async function openSession(ctx: CloudContext, identityId: string, m: MembershipRoute, g: { client: string | null; nowMs: number; expiresAt: Date }) {
  const { token, digest } = newToken(m.tesisId);
  const opened = await withTesis(ctx.app, { tesisId: m.tesisId }, async (tx) => {
    const facts = await loadServiceFacts(tx, m.tesisId);
    if (!facts) return null;
    // Hizmet bitince 90 gün salt okuma (giriş AÇIK); süre dolunca giriş kapanır (Ek-6/A §4.2).
    if (serviceState(facts, g.nowMs).phase === "KAPALI") return "KAPALI" as const;
    const claim = await tx.account.updateMany({ where: { id: m.accountId, status: "AKTIF", identityId }, data: { lastLoginAt: new Date(g.nowMs) } });
    if (claim.count === 0) return null;
    const session = await tx.session.create({
      data: { tesisId: m.tesisId, accountId: m.accountId, tokenHash: digest, client: g.client, lastUsedAt: new Date(g.nowMs), expiresAt: g.expiresAt },
    });
    return { session, account: await tx.account.findUniqueOrThrow({ where: { id: m.accountId } }) };
  });
  if (opened === null || opened === "KAPALI") return opened;
  return { token, session: contextOf(opened.account, opened.session.id, g.expiresAt) };
}

const openable = (ms: readonly ActiveMembership[], hint: string | undefined): ActiveMembership | undefined => {
  const open = ms.filter((m) => m.hizmet !== "KAPALI");
  return open.find((m) => m.tesisId === hint?.toLowerCase()) ?? open[0];
};

export async function login(ctx: CloudContext, g: LoginInput): Promise<OpenedSession> {
  const startedMs = Date.now();
  const nowMs = ctx.now();
  const email = normalizeEmail(g.email);
  const identity = email ? await identityByEmail(ctx, email) : null;
  const members = identity?.status === "AKTIF" ? await activeMemberships(ctx, identity.id, nowMs) : [];
  const target = openable(members, g.tesisId) ?? members[0];
  if (!identity || identity.status !== "AKTIF" || !identity.passwordHash || !identity.totpSecretSealed || !target) {
    await burnPasswordCheck(g.password);
    const locked = identity && !target ? await lockedMembership(ctx, identity.id) : null;
    if (locked) await recordAudit(ctx.app, { tesisId: locked.tesisId, actor: "giris", event: "GIRIS_REDDEDILDI", entity: "Account", entityId: locked.accountId, summary: { durum: "KILITLI", ...ipSummary(g.ip) } });
    return failAfterFloor(startedMs);
  }
  const throttle = loginThrottleFor(ctx);
  // Kilitliyken de parola doğrulaması koşar (eşit iş) ve yanıt bilinmeyen kimlikle AYNIDIR.
  const sourceLocked = throttle.isLocked(identity.id, g.ip, nowMs);
  const passwordOk = await verifyPassword(g.password, identity.passwordHash);
  if (sourceLocked) {
    await recordAudit(ctx.app, { tesisId: target.tesisId, actor: "giris", event: "GIRIS_REDDEDILDI", entity: "Account", entityId: target.accountId, summary: { sebep: "KAYNAK_KILITLI", ...ipSummary(g.ip) } });
    return failAfterFloor(startedMs);
  }
  const secret = ctx.secrets.open(identity.totpSecretSealed, identity.id);
  if (secret === null) {
    console.error(`[patron] kimlik ${identity.id}: TOTP sırrı çözülemedi (sır anahtarı değişmiş olabilir — kimlik sıfırlanmalı)`);
    throw new CloudError(500, "SUNUCU_HATASI", "Doğrulama kodu denetlenemedi; tesis yöneticinize başvurun");
  }
  const totp = verifyTotp(secret, g.totp, { atMs: nowMs, lastUsedStep: identity.totpLastStep });
  // Adım iddiası MERKEZDE atomik: aynı kod iki tesiste (ya da eşzamanlı iki girişte) ikinci kez geçemez.
  const claimed =
    passwordOk && totp.ok
      ? await withCentral(ctx.app, {}, (tx) => tx.identity.updateMany({ where: { id: identity.id, status: "AKTIF", OR: [{ totpLastStep: null }, { totpLastStep: { lt: totp.step } }] }, data: { totpLastStep: totp.step } }))
      : { count: 0 };
  if (claimed.count === 0) {
    await registerFailure(ctx, identity.id, target, { nowMs, ip: g.ip });
    return failAfterFloor(startedMs);
  }
  if (target.hizmet === "KAPALI") throw serviceClosed();
  const expiresAt = new Date(nowMs + ctx.config.OTURUM_AZAMI_GUN * 86_400_000);
  const opened = await openSession(ctx, identity.id, target, { client: g.client, nowMs, expiresAt });
  if (opened === "KAPALI") throw serviceClosed();
  if (!opened) {
    await registerFailure(ctx, identity.id, target, { nowMs, ip: g.ip });
    return failAfterFloor(startedMs);
  }
  throttle.clear(identity.id, g.ip);
  await recordAudit(ctx.app, { tesisId: target.tesisId, actor: accountActor(target.accountId), event: "GIRIS", entity: "Account", entityId: target.accountId, summary: { oturumId: opened.session.sessionId, istemci: g.client, ...ipSummary(g.ip) } });
  return { ...opened, expiresAt, facilities: choices(members) };
}

/** Bearer belirtecinden oturum: kapalı · süresi dolmuş · hesap AKTİF değil · hizmet KAPALI (90 gün doldu) → null. */
export async function resolveSession(ctx: CloudContext, token: string | undefined): Promise<SessionContext | null> {
  const tesisId = token ? tokenTesis(token) : null;
  if (!token || !tesisId) return null;
  const nowMs = ctx.now();
  const digest = tokenDigest(token);
  const row = await withLookup(ctx.app, { kind: "oturum", value: digest, tesisId }, (tx) => tx.session.findUnique({ where: { tokenHash: digest } }));
  if (!row || row.closedAt || row.tesisId !== tesisId) return null;
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
    return contextOf(account, row.id, row.expiresAt);
  });
}

/** Kimliğin AKTİF üyelikleri (KİLİTLİ görünmez), ada göre sıralı. */
export async function listFacilities(ctx: CloudContext, s: SessionContext): Promise<FacilityChoice[]> {
  return s.identityId ? choices(await activeMemberships(ctx, s.identityId, ctx.now())) : [];
}

/**
 * Tesis değişimi: hedefte AYNI kimliğe bağlı AKTİF hesap + hizmeti KAPALI olmayan tesis ⇒ orada yeni oturum, eskisi
 * CIKIS ile kapanır (claim: aynı oturumla iki geçiş iki oturum doğurmaz). TOTP sorulmaz; ömür ilk girişten devralınır.
 * Ret tek: 403 `TESIS_GECISI_YOK` (tesisin varlığı/üyeliğin durumu söylenmez).
 */
export async function switchFacility(ctx: CloudContext, s: SessionContext, tesisId: string): Promise<OpenedSession> {
  const nowMs = ctx.now();
  if (!s.identityId) throw switchDenied();
  const identityId = s.identityId;
  const route = await membershipRoute(ctx, identityId, tesisId.toLowerCase());
  const target = route ? await activeMembershipIn(ctx, identityId, route, nowMs) : null;
  if (!target || target.hizmet === "KAPALI") throw switchDenied();
  const old = await withTesis(ctx.app, { tesisId: s.tesisId }, async (tx) => {
    const closed = await tx.session.updateMany({ where: { id: s.sessionId, closedAt: null }, data: { closedAt: new Date(nowMs), closeReason: "CIKIS" } });
    return closed.count === 0 ? null : tx.session.findUnique({ where: { id: s.sessionId }, select: { client: true } });
  });
  if (!old) throw new CloudError(401, "OTURUM_YOK", "Oturum yok ya da süresi doldu; yeniden giriş yapın");
  await recordAudit(ctx.app, { tesisId: s.tesisId, actor: accountActor(s.accountId), event: "CIKIS", entity: "Account", entityId: s.accountId, summary: { sebep: "TESIS_GECISI" } });
  const expiresAt = new Date(Math.min(s.expiresAt.getTime(), nowMs + ctx.config.OTURUM_AZAMI_GUN * 86_400_000));
  const opened = await openSession(ctx, identityId, target, { client: old.client, nowMs, expiresAt });
  if (!opened || opened === "KAPALI") throw switchDenied();
  await recordAudit(ctx.app, { tesisId: target.tesisId, actor: accountActor(target.accountId), event: "TESIS_GECISI", entity: "Account", entityId: target.accountId, summary: { oturumId: opened.session.sessionId } });
  return { ...opened, expiresAt, facilities: choices(await activeMemberships(ctx, identityId, nowMs)) };
}

/** Çıkış: etkin oturum; `all` ile kimliğin BÜTÜN üyeliklerindeki açık oturumlar. */
export async function logout(ctx: CloudContext, s: SessionContext, g: { all?: boolean } = {}): Promise<void> {
  const nowMs = ctx.now();
  const closed = await withTesis(ctx.app, { tesisId: s.tesisId }, (tx) =>
    tx.session.updateMany({ where: { id: s.sessionId, closedAt: null }, data: { closedAt: new Date(nowMs), closeReason: "CIKIS" } }),
  );
  if (closed.count > 0) await recordAudit(ctx.app, { tesisId: s.tesisId, actor: accountActor(s.accountId), event: "CIKIS", entity: "Account", entityId: s.accountId });
  if (!g.all || !s.identityId) return;
  for (const r of await closeIdentitySessions(ctx, s.identityId, { nowMs, reason: "CIKIS" })) {
    if (r.count > 0) await recordAudit(ctx.app, { tesisId: r.tesisId, actor: accountActor(r.accountId), event: "CIKIS", entity: "Account", entityId: r.accountId, summary: { kapsam: "HEPSI", oturum: r.count } });
  }
}

/**
 * Hassas işlem kapısı (tek kaynak — parola değişimi · kendi hesabını silme): oturumun merkez kimliği AKTİF, parola + güncel
 * TOTP doğru ve kaynak kilitli değil. Yanlışta girişle aynı sayaç + ayak izi, 400 `GIRIS_BASARISIZ`. Adım iddiası ÇAĞIRANDA
 * atomik claim'dir (`totpStepClaim`): aynı kod ikinci kez geçmez.
 */
export async function verifyOwnFactors(ctx: CloudContext, s: SessionContext, g: { password: string; totp: string; ip: string | null }) {
  const nowMs = ctx.now();
  const identityId = s.identityId;
  const identity = identityId ? await withCentral(ctx.app, {}, (tx) => tx.identity.findUnique({ where: { id: identityId } })) : null;
  if (!identity?.passwordHash || !identity.totpSecretSealed || identity.status !== "AKTIF") throw new CloudError(401, "OTURUM_YOK", "Oturum geçersiz");
  const sourceLocked = loginThrottleFor(ctx).isLocked(identity.id, g.ip, nowMs);
  const secret = ctx.secrets.open(identity.totpSecretSealed, identity.id);
  const totp = secret ? verifyTotp(secret, g.totp, { atMs: nowMs, lastUsedStep: identity.totpLastStep }) : null;
  const passwordOk = await verifyPassword(g.password, identity.passwordHash);
  if (sourceLocked || !passwordOk || !totp?.ok) {
    if (!sourceLocked) await registerFailure(ctx, identity.id, { tesisId: s.tesisId, accountId: s.accountId }, { nowMs, ip: g.ip });
    throw wrongFactors();
  }
  return { identity, step: totp.step, nowMs };
}

export const wrongFactors = (): CloudError => new CloudError(400, "GIRIS_BASARISIZ", "Mevcut parola ya da doğrulama kodu hatalı");

/** TOTP adım iddiası (merkez, atomik): kimlik AKTİF ∧ adım ileri. */
export const totpStepClaim = (identityId: string, step: number) => ({ where: { id: identityId, status: "AKTIF" as const, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });

/** Kendi parolasını değiştirme (KİMLİKTE): mevcut parola + TOTP; kimliğin bütün tesislerindeki öteki oturumlar kapanır. */
export async function changeOwnPassword(ctx: CloudContext, s: SessionContext, g: { current: string; next: string; totp: string; ip: string | null }): Promise<void> {
  assertPasswordStrength(g.next);
  const { identity, step, nowMs } = await verifyOwnFactors(ctx, s, { password: g.current, totp: g.totp, ip: g.ip });
  const hash = await hashPassword(g.next);
  const claim = totpStepClaim(identity.id, step);
  const r = await withCentral(ctx.app, {}, (tx) => tx.identity.updateMany({ where: claim.where, data: { ...claim.data, passwordHash: hash } }));
  if (r.count === 0) throw wrongFactors();
  await closeIdentitySessions(ctx, identity.id, { nowMs, reason: "SIFIRLAMA", exceptSessionId: s.sessionId });
  await recordAudit(ctx.app, { tesisId: s.tesisId, actor: accountActor(s.accountId), event: "PAROLA_DEGISTI", entity: "Account", entityId: s.accountId });
}

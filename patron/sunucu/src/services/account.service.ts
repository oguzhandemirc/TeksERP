// HESAP YÖNETİMİ — tesis yöneticisi (`bulut:hesap:yonet`) kendi tesisinin ekibini yönetir: davet ·
// izin · kilit/aç · arşiv (PASIF; soft delete) · sıfırlama (yeniden davet). Hesap başına TEK tesis.
// Her yazma işlem kimliğiyle idempotent ve tesis başına ACCOUNT_ADMIN kilidi altında (İLK ifade);
// SON AKTİF YÖNETİCİ düşürülemez (izin, kilit, arşiv, sıfırlama — 409 SON_YONETICI). Kişi kendi
// hesabını kilitleyemez/arşivleyemez/sıfırlayamaz (parolasını kendi değiştirir).
import type { Account, AccountStatus } from "@prisma/client";
import { createInvite } from "../auth/invite.service";
import { normalizeEmail, type SessionContext } from "../auth/session.service";
import { ROLE_TEMPLATES, invalidAssignments, type RoleTemplate } from "../catalog/permissions";
import { accountActor } from "../lib/audit";
import type { Tx } from "../lib/db";
import { CloudError, forbidden, notFound, stateConflict } from "../lib/errors";
import { executeWrite, type WriteResult } from "../lib/idempotency";
import { uniqueViolationOn } from "../lib/prisma-errors";
import { withTesis } from "../lib/tenant";
import type { AccountLockRequest, AccountLockResponse, AccountsResponse } from "../wire/esitleme";
import type { Account as AccountWire } from "../wire/api";
import type { CloudContext } from "./context";

export const ADMIN_PERMISSION = "bulut:hesap:yonet";

export function accountView(a: Account): AccountWire {
  return {
    id: a.id,
    eposta: a.email,
    ad: a.name,
    durum: a.status,
    izinler: [...a.permissions].sort(),
    sonGiris: a.lastLoginAt?.toISOString() ?? null,
    davetBitis: a.status === "DAVETLI" ? (a.inviteExpiresAt?.toISOString() ?? null) : null,
    olusturulma: a.createdAt.toISOString(),
  };
}

function requireAdmin(s: SessionContext): void {
  if (!s.permissions.has(ADMIN_PERMISSION)) throw forbidden("Hesap yönetimi yetkiniz yok");
}

/** İzin listesi: şablon ya da açık liste; bilinmeyen/örtük kod 400 IZIN_BILINMIYOR. */
export function resolvePermissionInput(g: { izinler?: readonly string[]; sablon?: RoleTemplate }): string[] {
  const list = g.sablon ? [...ROLE_TEMPLATES[g.sablon]] : [...(g.izinler ?? [])];
  const bad = invalidAssignments(list);
  if (bad.length > 0) throw new CloudError(400, "IZIN_BILINMIYOR", `Tanınmayan izin: ${bad.join(", ")}`);
  return [...new Set(list)].sort();
}

const isActiveAdmin = (a: Pick<Account, "status" | "permissions">): boolean => a.status === "AKTIF" && a.permissions.includes(ADMIN_PERMISSION);

/** Değişiklik hedefin yöneticiliğini düşürüyorsa ve başka AKTİF yönetici yoksa 409. */
async function assertNotLastAdmin(tx: Tx, target: Account, after: Pick<Account, "status" | "permissions">): Promise<void> {
  if (!isActiveAdmin(target) || isActiveAdmin(after)) return;
  const others = await tx.account.count({ where: { tesisId: target.tesisId, status: "AKTIF", permissions: { has: ADMIN_PERMISSION }, id: { not: target.id } } });
  if (others === 0) throw new CloudError(409, "SON_YONETICI", "Tesisin son aktif hesap yöneticisi düşürülemez; önce başka bir yönetici atayın");
}

async function loadTarget(tx: Tx, s: SessionContext, id: string): Promise<Account> {
  const a = await tx.account.findFirst({ where: { id, tesisId: s.tesisId } });
  if (!a) throw notFound("Hesap");
  return a;
}

async function closeSessions(tx: Tx, accountId: string, nowMs: number, reason: "HESAP_KAPANDI" | "SIFIRLAMA"): Promise<void> {
  await tx.session.updateMany({ where: { accountId, closedAt: null }, data: { closedAt: new Date(nowMs), closeReason: reason } });
}

export async function listAccounts(ctx: CloudContext, s: SessionContext) {
  requireAdmin(s);
  const rows = await withTesis(ctx.app, { tesisId: s.tesisId }, (tx) => tx.account.findMany({ where: { tesisId: s.tesisId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }));
  return rows.map(accountView);
}

/** Fabrika kanalının hesap görünümü — yalnız açık alanlar (sır/izin/davet yok). */
const factoryAccountView = (a: Pick<Account, "id" | "name" | "email" | "status" | "lastLoginAt">): AccountLockResponse["hesap"] => ({
  id: a.id,
  ad: a.name,
  eposta: a.email,
  durum: a.status,
  sonGiris: a.lastLoginAt?.toISOString() ?? null,
});

/**
 * Fabrika kanalı `POST /v1/hesaplar` (S29): tesisin hesap listesi — fabrika panelinde salt okunur gösterilir.
 * Eşitleme rolü `accounts`ı OKUYAMAZ (mühürlü sırlar aynı satırda) ⇒ uygulama rolüyle, yalnız açık kolonlar seçilir.
 */
export async function listAccountsForFactory(ctx: CloudContext, caller: { readonly tesisId: string }): Promise<AccountsResponse> {
  const rows = await withTesis(ctx.app, { tesisId: caller.tesisId }, (tx) =>
    tx.account.findMany({
      where: { tesisId: caller.tesisId },
      select: { id: true, name: true, email: true, status: true, lastLoginAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 1000,
    }),
  );
  return {
    v: 1,
    hesaplar: rows.map(factoryAccountView),
  };
}

/**
 * Fabrika kanalı `POST /v1/hesap-kilitle` (B6): fabrika panelinden "kilitle" — kurulumun kendi tesisinde,
 * yalnız AKTIF → KILITLI (zaten KILITLI ise değişmeden döner), oturumlar kapanır, son aktif yönetici
 * kilitlenemez. İşlem kimliği makbuzu aktör olarak KURULUMU taşır (hesap oturumu yok).
 */
export async function lockAccountFromFactory(ctx: CloudContext, caller: { readonly tesisId: string; readonly installation: { readonly installationId: string } }, input: AccountLockRequest): Promise<WriteResult> {
  const nowMs = ctx.now();
  return executeWrite(ctx.app, {
    tesisId: caller.tesisId,
    accountId: caller.installation.installationId,
    action: "FABRIKA_HESAP_KILIT",
    clientToken: input.islemKimligi,
    body: { hesapId: input.hesapId, isteyen: input.isteyen },
    lock: { name: "ACCOUNT_ADMIN", key: caller.tesisId },
    run: async (tx) => {
      const target = await tx.account.findFirst({ where: { id: input.hesapId, tesisId: caller.tesisId } });
      if (!target) throw notFound("Hesap");
      if (target.status === "KILITLI") return { hesap: target, degisti: false };
      if (target.status !== "AKTIF") throw stateConflict(`Hesap ${target.status} durumunda; yalnız AKTIF hesap kilitlenir`, { durum: target.status });
      await assertNotLastAdmin(tx, target, { status: "KILITLI", permissions: target.permissions });
      const r = await tx.account.updateMany({ where: { id: target.id, tesisId: caller.tesisId, status: "AKTIF" }, data: { status: "KILITLI" } });
      if (r.count === 0) throw stateConflict("Hesap bu arada değişti; listeyi yenileyip tekrar deneyin");
      await closeSessions(tx, target.id, nowMs, "HESAP_KAPANDI");
      return { hesap: await tx.account.findUniqueOrThrow({ where: { id: target.id } }), degisti: true };
    },
    respond: (r) => ({ data: { v: 1, hesap: factoryAccountView(r.hesap) } }),
    // Değişmeyen (zaten KILITLI) istek iz bırakmaz: denetim olanı yazar, isteneni değil.
    audit: (r) => (r.degisti ? [{ actor: `fabrika:${caller.installation.installationId}`, event: "HESAP_KILITLI", entity: "Account", entityId: r.hesap.id, summary: { kaynak: "fabrika", isteyen: input.isteyen } }] : []),
  });
}

export interface CreateAccountInput {
  readonly clientToken: string;
  readonly eposta: string;
  readonly ad: string;
  readonly izinler?: readonly string[];
  readonly sablon?: RoleTemplate;
}

/** Aynı tesiste PASİF olmayan hesap aynı e-postayı taşıyamaz (DB'de kısmi UNIQUE de seddeder). Başka tesis SORULMAZ. */
export const emailInUseHere = (): CloudError => new CloudError(409, "EPOSTA_KULLANIMDA", "Bu e-posta adresi bu tesiste zaten bir hesapta kayıtlı");

export async function assertEmailFreeInFacility(tx: Tx, tesisId: string, email: string): Promise<void> {
  if (await tx.account.findFirst({ where: { tesisId, email, status: { not: "PASIF" } }, select: { id: true } })) throw emailInUseHere();
}

/** Davet: hesap DAVETLI doğar; davet belirteci YALNIZ canlı yanıtta (tekrar yanıtı "gösterilemez"). E-postanın başka tesiste
 *  etkin olup olmadığı burada SORULMAZ (davet e-postayı tutmaz); çakışma yalnız onayda, genel bir iletiyle reddedilir. */
export async function createAccount(ctx: CloudContext, s: SessionContext, input: CreateAccountInput): Promise<WriteResult> {
  requireAdmin(s);
  const email = normalizeEmail(input.eposta);
  const permissions = resolvePermissionInput(input);
  const invite = createInvite(ctx.now(), ctx.config.DAVET_GECERLILIK_SAAT);
  try {
    return await executeWrite(ctx.app, {
      tesisId: s.tesisId,
      accountId: s.accountId,
      action: "HESAP_DAVET",
      clientToken: input.clientToken,
      body: { eposta: email, ad: input.ad, izinler: permissions },
      lock: { name: "ACCOUNT_ADMIN", key: s.tesisId },
      run: async (tx) => {
        await assertEmailFreeInFacility(tx, s.tesisId, email);
        return tx.account.create({
          data: { tesisId: s.tesisId, email, name: input.ad, permissions, status: "DAVETLI", inviteTokenHash: invite.digest, inviteExpiresAt: invite.expiresAt, createdById: s.accountId },
        });
      },
      respond: (a) => ({
        status: 201,
        data: { hesap: accountView(a), davet: invite.token, davetBitis: invite.expiresAt.toISOString() },
        stored: { hesap: accountView(a), davetGosterilemez: true, davetBitis: invite.expiresAt.toISOString() },
      }),
      audit: (a) => [{ actor: accountActor(s.accountId), event: "HESAP_DAVET", entity: "Account", entityId: a.id, summary: { izinler: permissions } }],
    });
  } catch (err) {
    if (uniqueViolationOn(err, "tesis_email")) throw emailInUseHere();
    throw err;
  }
}

export interface UpdateAccountInput {
  readonly clientToken: string;
  readonly ad?: string;
  readonly izinler?: readonly string[];
  readonly sablon?: RoleTemplate;
}

export async function updateAccount(ctx: CloudContext, s: SessionContext, id: string, input: UpdateAccountInput): Promise<WriteResult> {
  requireAdmin(s);
  const permissions = input.izinler !== undefined || input.sablon !== undefined ? resolvePermissionInput(input) : undefined;
  return executeWrite(ctx.app, {
    tesisId: s.tesisId,
    accountId: s.accountId,
    action: "HESAP_GUNCELLE",
    clientToken: input.clientToken,
    body: { id, ad: input.ad ?? null, izinler: permissions ?? null },
    lock: { name: "ACCOUNT_ADMIN", key: s.tesisId },
    run: async (tx) => {
      const target = await loadTarget(tx, s, id);
      const next = { status: target.status, permissions: permissions ?? target.permissions };
      await assertNotLastAdmin(tx, target, next);
      // Arşivdeki (PASIF) hesap düzenlenmez: kimliği silinmiş kayıt yeniden tanımlanamasın (Ek-6/A §2.5). Atomik claim.
      const r = await tx.account.updateMany({
        where: { id, tesisId: s.tesisId, status: { not: "PASIF" } },
        data: { ...(input.ad ? { name: input.ad } : {}), ...(permissions ? { permissions } : {}) },
      });
      if (r.count === 0) throw stateConflict("Arşivdeki hesap düzenlenemez", { durum: "PASIF" });
      return tx.account.findUniqueOrThrow({ where: { id } });
    },
    respond: (a) => ({ data: accountView(a) }),
    audit: (a) => [{ actor: accountActor(s.accountId), event: "HESAP_GUNCELLENDI", entity: "Account", entityId: a.id, summary: { izinler: permissions ?? null, adDegisti: input.ad !== undefined } }],
  });
}

const STATUS_TRANSITIONS: Readonly<Record<"AKTIF" | "KILITLI" | "PASIF", readonly AccountStatus[]>> = {
  AKTIF: ["KILITLI"],
  KILITLI: ["AKTIF"],
  PASIF: ["DAVETLI", "AKTIF", "KILITLI"],
};

/** Durum geçişi (kilit · kilidi aç · arşiv) — atomik claim: `WHERE {id, beklenen durum}`. */
export async function setAccountStatus(ctx: CloudContext, s: SessionContext, id: string, input: { clientToken: string; durum: "AKTIF" | "KILITLI" | "PASIF" }): Promise<WriteResult> {
  requireAdmin(s);
  if (id === s.accountId) throw stateConflict("Kendi hesabınızın durumunu değiştiremezsiniz");
  const nowMs = ctx.now();
  return executeWrite(ctx.app, {
    tesisId: s.tesisId,
    accountId: s.accountId,
    action: "HESAP_DURUM",
    clientToken: input.clientToken,
    body: { id, durum: input.durum },
    lock: { name: "ACCOUNT_ADMIN", key: s.tesisId },
    run: async (tx) => {
      const target = await loadTarget(tx, s, id);
      const allowedFrom = STATUS_TRANSITIONS[input.durum];
      if (!allowedFrom.includes(target.status)) throw stateConflict(`Hesap ${target.status} durumundan ${input.durum} durumuna geçemez`, { durum: target.status });
      await assertNotLastAdmin(tx, target, { status: input.durum, permissions: target.permissions });
      const r = await tx.account.updateMany({
        where: { id, tesisId: s.tesisId, status: target.status },
        // Kapanış anı PASIF'le AYNI claim'de: kimlik silme işi bu andan 30 gün sayar (CHECK: PASIF ⇔ closed_at).
        data: { status: input.durum, ...(input.durum === "PASIF" ? { inviteTokenHash: null, inviteExpiresAt: null, closedAt: new Date(nowMs) } : {}) },
      });
      if (r.count === 0) throw stateConflict("Hesap bu arada değişti; listeyi yenileyip tekrar deneyin");
      if (input.durum !== "AKTIF") await closeSessions(tx, id, nowMs, "HESAP_KAPANDI");
      return tx.account.findUniqueOrThrow({ where: { id } });
    },
    respond: (a) => ({ data: accountView(a) }),
    audit: (a) => [{ actor: accountActor(s.accountId), event: `HESAP_${input.durum}`, entity: "Account", entityId: a.id }],
  });
}

/** Sıfırlama (telefon kaybı / parola unutma): parola + TOTP silinir, yeni davet; oturumlar kapanır. */
export async function resetAccount(ctx: CloudContext, s: SessionContext, id: string, input: { clientToken: string }): Promise<WriteResult> {
  requireAdmin(s);
  if (id === s.accountId) throw stateConflict("Kendi hesabınızı sıfırlayamazsınız; parolanızı Profil'den değiştirin");
  const nowMs = ctx.now();
  const invite = createInvite(nowMs, ctx.config.DAVET_GECERLILIK_SAAT);
  return executeWrite(ctx.app, {
    tesisId: s.tesisId,
    accountId: s.accountId,
    action: "HESAP_SIFIRLA",
    clientToken: input.clientToken,
    body: { id },
    lock: { name: "ACCOUNT_ADMIN", key: s.tesisId },
    run: async (tx) => {
      const target = await loadTarget(tx, s, id);
      if (target.status === "PASIF") throw stateConflict("Arşivdeki hesap sıfırlanamaz", { durum: target.status });
      await assertNotLastAdmin(tx, target, { status: "DAVETLI", permissions: target.permissions });
      const r = await tx.account.updateMany({
        where: { id, tesisId: s.tesisId, status: target.status },
        data: { status: "DAVETLI", passwordHash: null, totpSecretSealed: null, totpLastStep: null, inviteTokenHash: invite.digest, inviteExpiresAt: invite.expiresAt, failedLogins: 0, lockedUntil: null },
      });
      if (r.count === 0) throw stateConflict("Hesap bu arada değişti; listeyi yenileyip tekrar deneyin");
      await closeSessions(tx, id, nowMs, "SIFIRLAMA");
      return tx.account.findUniqueOrThrow({ where: { id } });
    },
    respond: (a) => ({
      data: { hesap: accountView(a), davet: invite.token, davetBitis: invite.expiresAt.toISOString() },
      stored: { hesap: accountView(a), davetGosterilemez: true, davetBitis: invite.expiresAt.toISOString() },
    }),
    audit: (a) => [{ actor: accountActor(s.accountId), event: "HESAP_SIFIRLANDI", entity: "Account", entityId: a.id }],
  });
}

export async function listAccountAudit(ctx: CloudContext, s: SessionContext, q: { cursor?: string; limit: number }) {
  requireAdmin(s);
  const rows = await withTesis(ctx.app, { tesisId: s.tesisId }, (tx) =>
    tx.accountAudit.findMany({
      where: { tesisId: s.tesisId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    }),
  );
  const page = rows.slice(0, q.limit);
  return {
    kayitlar: page.map((r) => ({ id: r.id, aktor: r.actor, olay: r.event, varlik: r.entity, varlikId: r.entityId, ozet: r.summary, zaman: r.createdAt.toISOString() })),
    sonraki: rows.length > q.limit ? page[page.length - 1]!.id : null,
  };
}

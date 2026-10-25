// =============================================================================
// BİLDİRİM PROFİLLERİ + FABRİKA VARSAYILANI — yönetici uçları (plan §5.6 F4)
// =============================================================================
// Profil yalnız tercih setidir, İZİN VERMEZ (görme süzgeci her katmanın üstünde). Silme = arşiv (durum
// geçişi, atomik claim). Hücre/üye kümesi saf yapılandırma pivotudur: replace, audit eylemin kendisinde
// (profil satırı) tx DIŞINDA. Fabrika eşiği yazıldıktan sonra koşul kaynaklarının görüntüsü tazelenir.
// =============================================================================
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { getNotificationEntry, NOTIFICATION_KINDS, type NotificationKind } from "../constants/notification-catalog";
import {
  NOTIFICATION_FACTORY_DEFAULT_STATES,
  NOTIFICATION_PROFILE_CELL_STATES,
  notificationFactoryParamsSchema,
} from "../constants/notification-preference";
import { tokenReplay } from "./helpers/token-replay.helper";
import { blindMemberCounts } from "./notification-profile-audience.service";
import { parseKindParams, refreshNotificationParams } from "./helpers/notification-params.helper";

const PROFILE_SELECT = {
  id: true, code: true, name: true, archivedAt: true, createdAt: true, updatedAt: true,
  cells: { select: { kind: true, state: true }, orderBy: { kind: "asc" } },
  members: { select: { userId: true, user: { select: { fullName: true, username: true } } }, orderBy: { userId: "asc" } },
} as const satisfies Prisma.NotificationProfileSelect;

type ProfileRow = Prisma.NotificationProfileGetPayload<{ select: typeof PROFILE_SELECT }>;

function profileView(p: ProfileRow) {
  return {
    id: p.id, kod: p.code, ad: p.name, arsivlendi: p.archivedAt,
    hucreler: p.cells.map((c) => ({ tur: c.kind, durum: c.state })),
    uyeler: p.members.map((m) => ({ userId: m.userId, ad: m.user.fullName || m.user.username })),
  };
}

const NOT_FOUND = () => AppError.notFound("Bildirim profili bulunamadı.", { code: "NOTIFICATION_PROFILE_NOT_FOUND" });
const ARCHIVED = () => AppError.conflict("Bildirim profili arşivlenmiş.", { code: "NOTIFICATION_PROFILE_ARCHIVED" });

async function loadProfile(id: string) {
  const p = await prisma.notificationProfile.findUnique({ where: { id }, select: PROFILE_SELECT });
  if (!p) throw NOT_FOUND();
  return profileView(p);
}

/** Claim düşünce ayrım: yok → 404, arşivli → 409. */
async function throwClaimFailure(id: string): Promise<never> {
  const p = await prisma.notificationProfile.findUnique({ where: { id }, select: { id: true } });
  throw p ? ARCHIVED() : NOT_FOUND();
}

export async function listProfiles(query: Record<string, unknown>) {
  const withArchived = query.arsiv === "1" || query.arsiv === "true";
  const rows = await prisma.notificationProfile.findMany({
    where: withArchived ? {} : { archivedAt: null },
    select: PROFILE_SELECT,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const blind = await blindMemberCounts(rows.flatMap((r) => r.members.map((m) => m.userId)));
  return {
    items: rows.map((r) => ({ ...profileView(r), izinsizUyeler: blind(r.members.map((m) => m.userId)) })),
  };
}

export const CreateProfileBody = z
  .object({
    kod: z.string().trim().min(1, "Profil kodu zorunlu.").max(40).regex(/^[A-Za-z0-9_-]+$/, "Profil kodu yalnız harf, rakam, - ve _ içerir."),
    ad: z.string().trim().min(1, "Profil adı zorunlu.").max(120),
    clientToken: z.string().uuid().optional(),
  })
  .strict();

function createReplay(code: string) {
  return tokenReplay<{ id: string; code: string }, ReturnType<typeof profileView>>({
    find: (db, token) => db.notificationProfile.findUnique({ where: { clientToken: token }, select: { id: true, code: true } }),
    alive: { neverDies: "arşivli profil de aynı denemenin sonucudur; replay onu döner" },
    identity: (p) => [{ ad: "kod", mevcut: p.code, gelen: code }],
    collision: "Bu işlem kimliği başka bir profile ait; formu yeniden gönderin.",
    respond: (p) => loadProfile(p.id),
  });
}

export async function createProfile(body: unknown, userId: string) {
  const b = CreateProfileBody.parse(body);
  const code = b.kod.toUpperCase();
  return createReplay(code).run(b.clientToken, async () => {
    let row: { id: string };
    try {
      row = await prisma.notificationProfile.create({
        data: { code, name: b.ad, clientToken: b.clientToken ?? null },
        select: { id: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && JSON.stringify(err.meta ?? {}).includes("code")) {
        throw AppError.conflict("Bu kodla bir profil zaten var.", { code: "NOTIFICATION_PROFILE_CODE_TAKEN" });
      }
      throw err;
    }
    await AuditService.log({ userId, action: "CREATE", tableName: "NOTIFICATION_PROFILE", recordId: row.id, newData: { kod: code, ad: b.ad } });
    return loadProfile(row.id);
  });
}

export const UpdateProfileBody = z.object({ ad: z.string().trim().min(1, "Profil adı zorunlu.").max(120) }).strict();

export async function updateProfile(id: string, body: unknown, userId: string) {
  const b = UpdateProfileBody.parse(body);
  const before = await loadProfile(id);
  const claimed = await prisma.notificationProfile.updateMany({ where: { id, archivedAt: null }, data: { name: b.ad } });
  if (claimed.count === 0) await throwClaimFailure(id);
  await AuditService.log({ userId, action: "UPDATE", tableName: "NOTIFICATION_PROFILE", recordId: id, oldData: { ad: before.ad }, newData: { ad: b.ad } });
  return loadProfile(id);
}

/**
 * Silme = arşiv (durum geçişi); üyesi olan profil CANLI REFERANSLIDIR → 409 (önce üyeler çıkarılır).
 * Satır kilidi önce alınır: üye yazımı da aynı satırı ilk claim'ler, sayım ardından taze okunur.
 */
export async function archiveProfile(id: string, userId: string) {
  const r = await prisma.$transaction(async (tx) => {
    const locked = await tx.notificationProfile.updateMany({ where: { id, archivedAt: null }, data: { updatedAt: new Date() } });
    if (locked.count === 0) return { ok: false as const, uyeSayisi: 0 };
    const uyeSayisi = await tx.notificationProfileMember.count({ where: { profileId: id } });
    if (uyeSayisi > 0) return { ok: false as const, uyeSayisi };
    await tx.notificationProfile.updateMany({ where: { id, archivedAt: null }, data: { archivedAt: new Date() } });
    return { ok: true as const, uyeSayisi: 0 };
  });
  if (!r.ok && r.uyeSayisi > 0) {
    throw AppError.conflict(`Profilin ${r.uyeSayisi} üyesi var; arşivlemeden önce üyeleri çıkarın.`, {
      code: "NOTIFICATION_PROFILE_IN_USE", uyeSayisi: r.uyeSayisi,
    });
  }
  if (!r.ok) await throwClaimFailure(id);
  await AuditService.log({ userId, action: "DELETE", tableName: "NOTIFICATION_PROFILE", recordId: id, newData: { arsivlendi: true } });
  return loadProfile(id);
}

const CellsBody = z
  .object({
    hucreler: z
      .array(z.object({ tur: z.string().min(1).max(64), durum: z.enum(NOTIFICATION_PROFILE_CELL_STATES, "Hücre durumu: ACIK · KAPALI · KILITLI") }).strict())
      .max(NOTIFICATION_KINDS.length),
  })
  .strict();

function parseCells(body: unknown): Array<{ kind: NotificationKind; state: string }> {
  const { hucreler } = CellsBody.parse(body);
  const seen = new Set<string>();
  return hucreler.map((h) => {
    if (!(NOTIFICATION_KINDS as readonly string[]).includes(h.tur)) {
      throw AppError.badRequest("Bildirim türü tanınmıyor.", { code: "NOTIFICATION_KIND_UNKNOWN", tur: h.tur });
    }
    if (seen.has(h.tur)) throw AppError.badRequest("Aynı tür iki kez gönderildi.", { code: "NOTIFICATION_PROFILE_CELL_DUPLICATE", tur: h.tur });
    seen.add(h.tur);
    return { kind: h.tur as NotificationKind, state: h.durum };
  });
}

/** Pivot replace; profil satırı tx içinde claim edilir (arşivle yarışan yazım 409). */
export async function replaceProfileCells(id: string, body: unknown, userId: string) {
  const cells = parseCells(body);
  const before = await loadProfile(id);
  const ok = await prisma.$transaction(async (tx) => {
    const claimed = await tx.notificationProfile.updateMany({ where: { id, archivedAt: null }, data: { updatedAt: new Date() } });
    if (claimed.count === 0) return false;
    await tx.notificationProfileCell.deleteMany({ where: { profileId: id } });
    if (cells.length > 0) await tx.notificationProfileCell.createMany({ data: cells.map((c) => ({ profileId: id, kind: c.kind, state: c.state })) });
    return true;
  });
  if (!ok) await throwClaimFailure(id);
  await AuditService.log({
    userId, action: "UPDATE", tableName: "NOTIFICATION_PROFILE", recordId: id,
    oldData: { hucreler: before.hucreler }, newData: { hucreler: cells.map((c) => ({ tur: c.kind, durum: c.state })) },
  });
  return loadProfile(id);
}

/** Taslak hücrelerde KILITLI olacak türlerde kendi uygulama-içi tercihini kapatmış üyeler (yazmaz). */
export async function lockPreview(id: string, body: unknown) {
  const cells = parseCells(body);
  const profile = await loadProfile(id);
  const lockedKinds = cells.filter((c) => c.state === "KILITLI").map((c) => c.kind);
  if (lockedKinds.length === 0 || profile.uyeler.length === 0) return { etkilenen: [] };
  const rows = await prisma.notificationPreference.findMany({
    where: { userId: { in: profile.uyeler.map((u) => u.userId) }, kind: { in: lockedKinds }, channel: "UYGULAMA", enabled: false },
    select: { userId: true, kind: true },
    orderBy: [{ userId: "asc" }, { kind: "asc" }],
  });
  const byUser = new Map<string, string[]>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.kind]);
  return {
    etkilenen: profile.uyeler
      .filter((u) => byUser.has(u.userId))
      .map((u) => ({ userId: u.userId, ad: u.ad, turler: byUser.get(u.userId)!.map((k) => ({ tur: k, ad: getNotificationEntry(k as NotificationKind).ad })) })),
  };
}

const MembersBody = z.object({ userIds: z.array(z.string().uuid()).max(5000) }).strict();

async function assertUsersExist(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true } });
  if (found.length !== ids.length) {
    const have = new Set(found.map((u) => u.id));
    throw AppError.badRequest("Kullanıcı bulunamadı.", { code: "USER_NOT_FOUND", ids: ids.filter((i) => !have.has(i)) });
  }
}

export async function replaceProfileMembers(id: string, body: unknown, userId: string) {
  const ids = [...new Set(MembersBody.parse(body).userIds)];
  await assertUsersExist(ids);
  const before = await loadProfile(id);
  const ok = await prisma.$transaction(async (tx) => {
    const claimed = await tx.notificationProfile.updateMany({ where: { id, archivedAt: null }, data: { updatedAt: new Date() } });
    if (claimed.count === 0) return false;
    await tx.notificationProfileMember.deleteMany({ where: { profileId: id } });
    if (ids.length > 0) await tx.notificationProfileMember.createMany({ data: ids.map((u) => ({ profileId: id, userId: u })) });
    return true;
  });
  if (!ok) await throwClaimFailure(id);
  await AuditService.log({
    userId, action: "UPDATE", tableName: "NOTIFICATION_PROFILE", recordId: id,
    oldData: { uyeler: before.uyeler.map((u) => u.userId) }, newData: { uyeler: ids },
  });
  return loadProfile(id);
}

// ---- fabrika varsayılanı -----------------------------------------------------

export async function getFactoryDefaults() {
  const rows = await prisma.notificationFactoryDefault.findMany({ select: { kind: true, state: true, params: true, extraRecipientIds: true } });
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  return {
    turler: NOTIFICATION_KINDS.map((kind) => {
      const e = getNotificationEntry(kind);
      const r = byKind.get(kind);
      const env = r?.params ? notificationFactoryParamsSchema.safeParse(r.params) : null;
      let esikler: Record<string, unknown> = {};
      try {
        esikler = parseKindParams(kind, env?.success ? env.data.degerler : {});
      } catch {
        esikler = parseKindParams(kind, {});
      }
      return {
        tur: kind, ad: e.ad, grup: e.grup, kilit: e.kilit, durum: r?.state ?? "MIRAS",
        esikler, esikVar: !!e.paramSemasi, ekAlicilar: r?.extraRecipientIds ?? [],
      };
    }),
  };
}

const FactoryBody = z
  .object({
    turler: z
      .array(
        z
          .object({
            tur: z.string().min(1).max(64),
            durum: z.enum(NOTIFICATION_FACTORY_DEFAULT_STATES, "Durum: MIRAS · ACIK · KAPALI · KILITLI"),
            esikler: z.record(z.string().max(32), z.unknown()).optional(),
            ekAlicilar: z.array(z.string().uuid()).max(200).optional(),
          })
          .strict(),
      )
      .max(NOTIFICATION_KINDS.length),
  })
  .strict();

/** Verilen türlerin satırını yazar (verilmeyen dokunulmaz); eşikler katalog şemasıyla doğrulanır. */
export async function putFactoryDefaults(body: unknown, userId: string) {
  const { turler } = FactoryBody.parse(body);
  const seen = new Set<string>();
  const rows = turler.map((t) => {
    if (!(NOTIFICATION_KINDS as readonly string[]).includes(t.tur)) throw AppError.badRequest("Bildirim türü tanınmıyor.", { code: "NOTIFICATION_KIND_UNKNOWN", tur: t.tur });
    if (seen.has(t.tur)) throw AppError.badRequest("Aynı tür iki kez gönderildi.", { code: "NOTIFICATION_FACTORY_DUPLICATE", tur: t.tur });
    seen.add(t.tur);
    const kind = t.tur as NotificationKind;
    let params: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
    if (t.esikler !== undefined) {
      if (!getNotificationEntry(kind).paramSemasi) throw AppError.badRequest("Bu türün eşiği yok.", { code: "NOTIFICATION_PARAMS_INVALID", tur: kind });
      try {
        params = { schemaVersion: 1, degerler: parseKindParams(kind, t.esikler) } as Prisma.InputJsonValue;
      } catch {
        throw AppError.badRequest("Eşik değerleri geçersiz.", { code: "NOTIFICATION_PARAMS_INVALID", tur: kind });
      }
    }
    return { kind, state: t.durum, params, extraRecipientIds: [...new Set(t.ekAlicilar ?? [])] };
  });
  await assertUsersExist([...new Set(rows.flatMap((r) => r.extraRecipientIds))]);
  const before = new Map((await getFactoryDefaults()).turler.map((t) => [t.tur as string, t]));
  const ids = await prisma.$transaction(async (tx) => {
    const out: Array<{ kind: string; id: string }> = [];
    for (const r of rows) {
      const row = await tx.notificationFactoryDefault.upsert({
        where: { kind: r.kind },
        create: { kind: r.kind, state: r.state, params: r.params, extraRecipientIds: r.extraRecipientIds },
        update: { state: r.state, params: r.params, extraRecipientIds: r.extraRecipientIds },
        select: { id: true },
      });
      out.push({ kind: r.kind, id: row.id });
    }
    return out;
  });
  await refreshNotificationParams(prisma);
  const after = await getFactoryDefaults();
  const afterByKind = new Map(after.turler.map((t) => [t.tur as string, t]));
  await AuditService.logMany(ids.map((r) => ({
    userId, action: "UPDATE" as const, tableName: "NOTIFICATION_FACTORY_DEFAULT", recordId: r.id,
    oldData: before.get(r.kind) ?? null, newData: afterByKind.get(r.kind) ?? null,
  })));
  return after;
}

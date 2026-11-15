// =============================================================================
// BİLDİRİM TERCİH PROFİLLERİ — hazır (katalogdan türeyen) + kişisel kayıtlı profiller (2026-11-15)
// =============================================================================
// Profil = tür kümesi, kanaldan bağımsız; bir KANALA uygulanır (panel UYGULAMA, patron telefonu PATRON_PUSH).
// Uygulama hedef duruma yazar → doğası gereği idempotent; mevcut PUT yolundan (`writePreferenceItems`) tek tx,
// seyrek yazım, kilitli türe dokunmaz. "Etkin profil" kayıtlı çözümden hesaplanır (birden çok eşleşebilir).
// Kişisel profil kayıt yaratır → `clientToken` replay'i tek boğazdan; silme = arşiv (atomik claim).
// =============================================================================
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import {
  getNotificationEntry,
  NOTIFICATION_KINDS,
  type NotificationKanal,
  type NotificationKind,
} from "../constants/notification-catalog";
import { PRESET_PROFILES, getPresetProfile, presetKinds, type PresetProfile } from "../constants/notification-preset-profiles";
import { canSeeNotificationType } from "./helpers/notification-visibility.helper";
import { channelEnabled, prefKey, resolvePreference } from "./helpers/notification-preference.helper";
import { tokenReplay } from "./helpers/token-replay.helper";
import {
  context,
  getPreferences,
  writePreferenceItems,
  type PreferenceContext,
  type PreferenceItemInput,
  type PreferenceViewer,
} from "./notification-preference.service";

/** Profilin uygulanabildiği kanallar (OZET/TABLET_SES profil kanalı değildir). */
export const PROFILE_CHANNELS = ["UYGULAMA", "MASAUSTU", "PATRON_PUSH"] as const satisfies readonly NotificationKanal[];
export type ProfileChannel = (typeof PROFILE_CHANNELS)[number];

/** Kişi başına canlı kişisel profil tavanı. */
export const PERSONAL_PROFILE_LIMIT = 20;

const AUDIT_TABLE = "NOTIFICATION_PREFERENCE_PROFILE";
const channelSchema = z.enum(PROFILE_CHANNELS, "Profil bu kanala uygulanamaz.");

/** Hedef: tür → açık mı. Kararı olmayan tür haritada yoktur (uygulamada aynen kalır). */
type Target = ReadonlyMap<NotificationKind, boolean>;

const NOT_FOUND = () => AppError.notFound("Bildirim profili bulunamadı.", { code: "NOTIFICATION_PREF_PROFILE_NOT_FOUND" });
const ARCHIVED = () => AppError.conflict("Bildirim profili silinmiş.", { code: "NOTIFICATION_PREF_PROFILE_ARCHIVED" });
const NAME_TAKEN = () => AppError.conflict("Bu adla bir profiliniz zaten var.", { code: "NOTIFICATION_PREF_PROFILE_NAME_TAKEN" });

/** Kişinin görebildiği ve kanalı taşıyan türler (katalog sırası). */
function channelKinds(ctx: PreferenceContext, channel: ProfileChannel): NotificationKind[] {
  return NOTIFICATION_KINDS.filter((k) => canSeeNotificationType(ctx.subject, k, ctx.env) && getNotificationEntry(k).kanallar.includes(channel));
}

function presetTarget(p: PresetProfile, kinds: readonly NotificationKind[]): Target {
  return new Map(kinds.map((k) => [k, p.includes(getNotificationEntry(k))]));
}

function personalTarget(row: { onKinds: string[]; offKinds: string[] }, kinds: readonly NotificationKind[]): Target {
  const on = new Set(row.onKinds);
  const off = new Set(row.offKinds);
  const out = new Map<NotificationKind, boolean>();
  for (const k of kinds) {
    if (on.has(k)) out.set(k, true);
    else if (off.has(k)) out.set(k, false);
  }
  return out;
}

/** Kayıtlı çözüm hedefle birebir mi (UYGULAMA'da kilitli tür sayılmaz). Hiç karşılaştırılabilir tür yoksa etkin değildir. */
function matches(ctx: PreferenceContext, channel: ProfileChannel, target: Target): boolean {
  const o = { env: ctx.env, layers: ctx.layers };
  let compared = 0;
  for (const [kind, want] of target) {
    const inApp = resolvePreference(ctx.subject, kind, "UYGULAMA", o);
    if (channel === "UYGULAMA" && inApp.kilit) continue;
    const r = channel === "UYGULAMA" ? inApp : resolvePreference(ctx.subject, kind, channel, o);
    if ((r.durum === "ACIK") !== want) return false;
    compared += 1;
  }
  return compared > 0;
}

/**
 * Hedefi tam gövdeye çevirir: kişinin mevcut satırları (kapsam dahil) korunur, yalnız hedefin türleri değişir.
 * UYGULAMA: açık → Anlık (OZET kapalı), kapalı → ikisi kapalı; kilitli tür atlanır. Diğer kanal: kanal = hedef; hedef açık
 * ama tür ne uygulama içinde ne özette açıksa UYGULAMA da açılır (çözücü öyle bir türde telefonu/masaüstünü kapatır).
 */
async function buildItems(v: PreferenceViewer, ctx: PreferenceContext, channel: ProfileChannel, target: Target): Promise<PreferenceItemInput[]> {
  const o = { env: ctx.env, layers: ctx.layers };
  const rows = await prisma.notificationPreference.findMany({
    where: { userId: v.userId },
    select: { kind: true, channel: true, enabled: true, scope: true },
  });
  const items = new Map<string, PreferenceItemInput>();
  const locked = (k: NotificationKind) => resolvePreference(ctx.subject, k, "UYGULAMA", o).kilit;
  for (const r of rows) {
    const kind = r.kind as NotificationKind;
    if (!(NOTIFICATION_KINDS as readonly string[]).includes(r.kind) || !canSeeNotificationType(ctx.subject, kind, ctx.env)) continue;
    const ch = r.channel as NotificationKanal;
    if (!getNotificationEntry(kind).kanallar.includes(ch)) continue;
    const isLocked = locked(kind);
    if (ch === "UYGULAMA" && isLocked) continue; // kilitli türde UYGULAMA satırı anlamsız (ve kapalıysa 409 doğurur)
    const it: PreferenceItemInput = { tur: kind, kanal: ch, acik: r.enabled };
    if (r.scope !== null && ch === "UYGULAMA") it.kapsam = r.scope;
    items.set(prefKey(kind, ch), it);
  }
  const put = (kind: NotificationKind, ch: NotificationKanal, acik: boolean) => {
    const prev = items.get(prefKey(kind, ch));
    items.set(prefKey(kind, ch), prev?.kapsam !== undefined ? { tur: kind, kanal: ch, acik, kapsam: prev.kapsam } : { tur: kind, kanal: ch, acik });
  };
  for (const [kind, want] of target) {
    const entry = getNotificationEntry(kind);
    if (channel === "UYGULAMA") {
      if (locked(kind)) continue;
      put(kind, "UYGULAMA", want);
      if (entry.kanallar.includes("OZET")) put(kind, "OZET", false);
      continue;
    }
    put(kind, channel, want);
    if (want && !locked(kind)) {
      const inAppOn = resolvePreference(ctx.subject, kind, "UYGULAMA", o).durum === "ACIK";
      const digestOn = channelEnabled(ctx.subject, kind, "OZET", o).acik;
      if (!inAppOn && !digestOn) put(kind, "UYGULAMA", true);
    }
  }
  return [...items.values()];
}

// ---- liste -----------------------------------------------------------------

const PERSONAL_SELECT = { id: true, name: true, onKinds: true, offKinds: true, createdAt: true, updatedAt: true } as const;
type PersonalRow = Prisma.NotificationPreferenceProfileGetPayload<{ select: typeof PERSONAL_SELECT }>;

function personalView(r: PersonalRow, kinds: readonly NotificationKind[]) {
  const t = personalTarget(r, kinds);
  return {
    id: r.id,
    ad: r.name,
    acik: [...t].filter(([, on]) => on).map(([k]) => k),
    kapali: [...t].filter(([, on]) => !on).map(([k]) => k),
    olusturuldu: r.createdAt,
    guncellendi: r.updatedAt,
  };
}

async function livePersonal(userId: string): Promise<PersonalRow[]> {
  return prisma.notificationPreferenceProfile.findMany({
    where: { userId, archivedAt: null },
    select: PERSONAL_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

function view(ctx: PreferenceContext, channel: ProfileChannel, personal: PersonalRow[]) {
  const kinds = channelKinds(ctx, channel);
  const etkin: string[] = [];
  const hazir = PRESET_PROFILES.map((p) => {
    const t = presetTarget(p, kinds);
    if (matches(ctx, channel, t)) etkin.push(`hazir:${p.kod}`);
    const onKinds = [...t].filter(([, on]) => on).map(([k]) => k);
    return { kod: p.kod, ad: p.ad, aciklama: p.aciklama, acik: onKinds };
  });
  const kisisel = personal.map((r) => {
    if (matches(ctx, channel, personalTarget(r, kinds))) etkin.push(`kisisel:${r.id}`);
    return personalView(r, kinds);
  });
  return { kanal: channel, turSayisi: kinds.length, hazir, kisisel, etkin };
}

const ListQuery = z.object({ kanal: channelSchema.optional() }).strip();

export async function listProfiles(v: PreferenceViewer, query: unknown) {
  const { kanal = "UYGULAMA" } = ListQuery.parse(query ?? {});
  const ctx = await context(v);
  return view(ctx, kanal, await livePersonal(v.userId));
}

// ---- uygula ----------------------------------------------------------------

export const ApplyBody = z
  .object({
    kanal: channelSchema,
    hazir: z.string().max(40).optional(),
    kisisel: z.string().uuid("Profil kimliği geçersiz.").optional(),
  })
  .strict()
  .refine((b) => (b.hazir === undefined) !== (b.kisisel === undefined), "Hazır ya da kişisel profilden yalnız biri verilir.");

export async function applyProfile(v: PreferenceViewer, body: unknown) {
  const b = ApplyBody.parse(body);
  const ctx = await context(v);
  const kinds = channelKinds(ctx, b.kanal);
  let target: Target;
  if (b.hazir !== undefined) {
    const p = getPresetProfile(b.hazir);
    if (!p) throw AppError.badRequest("Hazır profil tanınmıyor.", { code: "NOTIFICATION_PRESET_UNKNOWN", hazir: b.hazir });
    target = presetTarget(p, kinds);
  } else {
    const row = await prisma.notificationPreferenceProfile.findFirst({
      where: { id: b.kisisel, userId: v.userId },
      select: { onKinds: true, offKinds: true, archivedAt: true },
    });
    if (!row) throw NOT_FOUND();
    if (row.archivedAt) throw ARCHIVED();
    target = personalTarget(row, kinds);
  }
  await writePreferenceItems(v, ctx, await buildItems(v, ctx, b.kanal, target));
  const fresh = await context(v);
  return { ...(await getPreferences(v)), profiller: view(fresh, b.kanal, await livePersonal(v.userId)) };
}

// ---- kişisel profil CRUD ---------------------------------------------------

/** O anki KAYITLI çözümün fotoğrafı: kanalda açık → on, değil → off (yalnız görünen türler). */
function snapshot(ctx: PreferenceContext, channel: ProfileChannel): { onKinds: string[]; offKinds: string[] } {
  const o = { env: ctx.env, layers: ctx.layers };
  const onKinds: string[] = [];
  const offKinds: string[] = [];
  for (const k of channelKinds(ctx, channel)) {
    (resolvePreference(ctx.subject, k, channel, o).durum === "ACIK" ? onKinds : offKinds).push(k);
  }
  return { onKinds, offKinds };
}

const nameSchema = z.string().trim().min(1, "Profil adı zorunlu.").max(60, "Profil adı en çok 60 karakter.");

export const CreateBody = z.object({ ad: nameSchema, kanal: channelSchema, clientToken: z.string().uuid().optional() }).strict();

function isNameConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && !JSON.stringify(err.meta ?? {}).includes("clientToken");
}

async function respondOne(v: PreferenceViewer, id: string, channel: ProfileChannel) {
  const ctx = await context(v);
  const all = await livePersonal(v.userId);
  const v2 = view(ctx, channel, all);
  return { profil: v2.kisisel.find((p) => p.id === id) ?? null, profiller: v2 };
}

function createReplay(v: PreferenceViewer, ad: string, channel: ProfileChannel) {
  return tokenReplay<{ id: string; name: string; userId: string }, Awaited<ReturnType<typeof respondOne>>>({
    find: (db, token) => db.notificationPreferenceProfile.findUnique({ where: { clientToken: token }, select: { id: true, name: true, userId: true } }),
    alive: { neverDies: "silinmiş (arşivli) profil de aynı denemenin sonucudur; replay onu döner" },
    identity: (p) => [
      { ad: "userId", mevcut: p.userId, gelen: v.userId },
      { ad: "ad", mevcut: p.name, gelen: ad },
    ],
    collision: "Bu işlem kimliği başka bir profile ait; yeniden kaydedin.",
    respond: (p) => respondOne(v, p.id, channel),
  });
}

export async function createProfile(v: PreferenceViewer, body: unknown) {
  const b = CreateBody.parse(body);
  return createReplay(v, b.ad, b.kanal).run(b.clientToken, async () => {
    const ctx = await context(v);
    const snap = snapshot(ctx, b.kanal);
    const live = await prisma.notificationPreferenceProfile.count({ where: { userId: v.userId, archivedAt: null } });
    if (live >= PERSONAL_PROFILE_LIMIT) {
      throw AppError.conflict(`En çok ${PERSONAL_PROFILE_LIMIT} profil kaydedebilirsiniz; önce birini silin.`, { code: "NOTIFICATION_PREF_PROFILE_LIMIT" });
    }
    let row: { id: string };
    try {
      row = await prisma.notificationPreferenceProfile.create({
        data: { userId: v.userId, name: b.ad, ...snap, clientToken: b.clientToken ?? null },
        select: { id: true },
      });
    } catch (err) {
      if (isNameConflict(err)) throw NAME_TAKEN();
      throw err;
    }
    await AuditService.log({
      userId: v.userId, action: "CREATE", tableName: AUDIT_TABLE, recordId: row.id,
      newData: { ad: b.ad, kanal: b.kanal, acikSayi: snap.onKinds.length, kapaliSayi: snap.offKinds.length },
    });
    return respondOne(v, row.id, b.kanal);
  });
}

export const UpdateBody = z
  .object({ ad: nameSchema.optional(), kanal: channelSchema.optional(), seciminiGuncelle: z.boolean().optional() })
  .strict()
  .refine((b) => b.ad !== undefined || b.seciminiGuncelle === true, "Ad ya da seçim güncellemesi verilir.")
  .refine((b) => b.seciminiGuncelle !== true || b.kanal !== undefined, "Seçimi güncellemek için kanal verilir.");

/** Claim düşünce ayrım: kişinin değilse/yoksa 404, arşivliyse 409. */
async function throwClaimFailure(v: PreferenceViewer, id: string): Promise<never> {
  const p = await prisma.notificationPreferenceProfile.findFirst({ where: { id, userId: v.userId }, select: { id: true } });
  throw p ? ARCHIVED() : NOT_FOUND();
}

export async function updateProfile(v: PreferenceViewer, id: string, body: unknown) {
  const b = UpdateBody.parse(body);
  const channel = b.kanal ?? "UYGULAMA";
  const snap = b.seciminiGuncelle ? snapshot(await context(v), channel) : null;
  const before = await prisma.notificationPreferenceProfile.findFirst({ where: { id, userId: v.userId }, select: { name: true } });
  let claimed: { count: number };
  try {
    claimed = await prisma.notificationPreferenceProfile.updateMany({
      where: { id, userId: v.userId, archivedAt: null },
      data: { ...(b.ad !== undefined ? { name: b.ad } : {}), ...(snap ?? {}) },
    });
  } catch (err) {
    if (isNameConflict(err)) throw NAME_TAKEN();
    throw err;
  }
  if (claimed.count === 0) await throwClaimFailure(v, id);
  await AuditService.log({
    userId: v.userId, action: "UPDATE", tableName: AUDIT_TABLE, recordId: id,
    oldData: { ad: before?.name },
    newData: { ...(b.ad !== undefined ? { ad: b.ad } : {}), ...(snap ? { kanal: channel, acikSayi: snap.onKinds.length, kapaliSayi: snap.offKinds.length } : {}) },
  });
  return respondOne(v, id, channel);
}

/** Silme = arşiv (durum geçişi, atomik claim); uygulanmış tercihler yerinde kalır. */
export async function archiveProfile(v: PreferenceViewer, id: string, query: unknown) {
  const { kanal = "UYGULAMA" } = ListQuery.parse(query ?? {});
  const claimed = await prisma.notificationPreferenceProfile.updateMany({
    where: { id, userId: v.userId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (claimed.count === 0) await throwClaimFailure(v, id);
  await AuditService.log({ userId: v.userId, action: "DELETE", tableName: AUDIT_TABLE, recordId: id, newData: { arsivlendi: true } });
  const ctx = await context(v);
  return view(ctx, kanal, await livePersonal(v.userId));
}

// ---- yönetici: rol profilini hazır profille doldurma -------------------------

/** Süzgeçsiz tam küme (yönetici rol profili matrisini doldurur; kayıt mevcut `PUT /profiller/:id/hucreler` ile). */
export function listPresetsForAdmin() {
  return { items: PRESET_PROFILES.map((p) => ({ kod: p.kod, ad: p.ad, aciklama: p.aciklama, turler: presetKinds(p) })) };
}

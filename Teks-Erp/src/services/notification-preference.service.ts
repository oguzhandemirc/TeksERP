// =============================================================================
// BİLDİRİM TERCİHLERİ — kişisel uçlar (plan §5.6 F4): tercihler · önizleme · varsayılana dön · ayarlar · takip
// =============================================================================
// Çözüm TEK yerden: `resolvePreference`/`resolveAllPreferences`. PUT tam gövdedir ama SEYREK yazar:
// yalnız taban çözümden (kişisel satır yokken) sapan ya da kapsam taşıyan satır kalır. Kilit yalnız
// UYGULAMA'yı zorlar (kilitli türde kapatma 409). Önizleme YAZMAZ.
// =============================================================================
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { factoryDayKeyUtcMidnight } from "../constants/time";
import {
  getNotificationEntry,
  NOTIFICATION_KINDS,
  type NotificationKanal,
  type NotificationKind,
} from "../constants/notification-catalog";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_QUIET_CHANNELS,
  notificationScopeSchema,
  QUIET_TIME_PATTERN,
  type NotificationScope,
} from "../constants/notification-preference";
import { matchesPermission } from "../middlewares/rbac.middleware";
import { readDokumaEnabled } from "./system-setting.service";
import { loadNotificationVisibilityEnv, canSeeNotificationType, type NotificationVisibilityEnv } from "./helpers/notification-visibility.helper";
import {
  channelEnabled,
  loadPreferenceLayers,
  prefKey,
  resolveAllPreferences,
  resolvePreference,
  type PreferenceLayers,
  type PreferenceRowView,
  type PreferenceSubject,
} from "./helpers/notification-preference.helper";
import { parseKindParams } from "./helpers/notification-params.helper";
import { followTargetOf, type FollowTarget } from "./helpers/record-follow.helper";

export interface PreferenceViewer {
  userId: string;
  permissions: readonly string[];
}

const DAY_MS = 86_400_000;
const PREVIEW_DAYS = 30;
/** Kapsamlı türde iletilen payın TAHMİNİ (ölçü kişi başına tutulmaz; önizleme yaklaşık "haftada ~N"dir). */
const SCOPE_PREVIEW_FACTOR = 0.5;

const isKind = (k: string): k is NotificationKind => (NOTIFICATION_KINDS as readonly string[]).includes(k);

async function context(v: PreferenceViewer): Promise<{ subject: PreferenceSubject; env: NotificationVisibilityEnv; layers: PreferenceLayers }> {
  const env = await loadNotificationVisibilityEnv(prisma);
  const layers = await loadPreferenceLayers(prisma, [v.userId]);
  return { subject: { userId: v.userId, permissions: v.permissions }, env, layers };
}

// ---- tercihler ---------------------------------------------------------------

const PreferenceItem = z
  .object({
    tur: z.string().min(1).max(64),
    kanal: z.enum(NOTIFICATION_CHANNELS, "Kanal tanınmıyor."),
    acik: z.boolean(),
    kapsam: z.unknown().optional(),
  })
  .strict();
export const PreferencesBody = z.object({ tercihler: z.array(PreferenceItem).max(1000) }).strict();

export async function getPreferences(v: PreferenceViewer) {
  const { subject, env, layers } = await context(v);
  const rows = await prisma.notificationPreference.findMany({
    where: { userId: v.userId },
    select: { id: true, kind: true, channel: true, enabled: true, scope: true },
    orderBy: [{ kind: "asc" }, { channel: "asc" }],
  });
  return {
    hucreler: resolveAllPreferences(subject, { env, layers }),
    satirlar: rows.map((r) => ({ id: r.id, tur: r.kind, kanal: r.channel, acik: r.enabled, kapsam: r.scope })),
  };
}

/** Kapsamı katalog beyanıyla doğrular — yalnız daraltır; tanınmayan/beyansız anahtar 400. */
function validateScope(kind: NotificationKind, raw: unknown): NotificationScope {
  const parsed = notificationScopeSchema.safeParse({ schemaVersion: 1, ...(raw as object) });
  const bad = (m: string) => AppError.badRequest(m, { code: "NOTIFICATION_SCOPE_INVALID", tur: kind });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !parsed.success) throw bad("Kapsam süzgeci tanınmıyor.");
  const decl = getNotificationEntry(kind).kapsam ?? {};
  const scope = parsed.data;
  if (scope.yalnizTakip && !decl.yalnizTakip) throw bad("Bu türde 'yalnız takip ettiklerim' süzgeci yok.");
  if (scope.istasyonlar !== undefined && !decl.istasyonlar) throw bad("Bu türde istasyon süzgeci yok.");
  for (const [key, value] of Object.entries(scope.esik ?? {})) {
    if (!decl.esik?.[key]) throw bad(`Bu türde '${key}' eşiği yok.`);
    try {
      parseKindParams(kind, { [key]: value });
    } catch {
      throw bad(`'${key}' eşiği geçersiz.`);
    }
  }
  return scope;
}

/** Gövdeyi doğrular ve SEYREK satır kümesine çevirir (yazmaz). */
function planPreferenceRows(
  subject: PreferenceSubject,
  env: NotificationVisibilityEnv,
  layers: PreferenceLayers,
  items: z.infer<typeof PreferenceItem>[],
): Map<string, { kind: NotificationKind; channel: NotificationKanal; row: PreferenceRowView }> {
  const base = { env, layers, taslak: new Map<string, PreferenceRowView | null>() };
  const out = new Map<string, { kind: NotificationKind; channel: NotificationKanal; row: PreferenceRowView }>();
  for (const it of items) {
    if (!isKind(it.tur) || !canSeeNotificationType(subject, it.tur, env)) {
      throw AppError.badRequest("Bu bildirim türünü göremezsiniz.", { code: "NOTIFICATION_KIND_NOT_VISIBLE", tur: it.tur });
    }
    const kind = it.tur;
    const entry = getNotificationEntry(kind);
    const channel = it.kanal as NotificationKanal;
    if (!entry.kanallar.includes(channel)) {
      throw AppError.badRequest("Bu tür bu kanaldan gönderilmez.", { code: "NOTIFICATION_CHANNEL_INVALID", tur: kind, kanal: channel });
    }
    const key = prefKey(kind, channel);
    if (out.has(key)) throw AppError.badRequest("Aynı tür ve kanal iki kez gönderildi.", { code: "NOTIFICATION_PREFERENCE_DUPLICATE", tur: kind, kanal: channel });
    const inAppBase = resolvePreference(subject, kind, "UYGULAMA", base);
    if (channel === "UYGULAMA" && inAppBase.kilit && !it.acik) {
      throw AppError.conflict("Bu bildirim kilitli; uygulama içinde kapatılamaz.", { code: "NOTIFICATION_KIND_LOCKED", tur: kind });
    }
    let scope: NotificationScope | null = null;
    if (it.kapsam !== undefined && it.kapsam !== null) {
      if (channel !== "UYGULAMA") throw AppError.badRequest("Kapsam yalnız uygulama içi kanalda verilir.", { code: "NOTIFICATION_SCOPE_INVALID", tur: kind });
      if (inAppBase.kilit) throw AppError.badRequest("Kilitli türde kapsam süzgeci verilemez.", { code: "NOTIFICATION_SCOPE_INVALID", tur: kind });
      scope = validateScope(kind, it.kapsam);
    }
    const baseOn = channel === "UYGULAMA" ? inAppBase.durum === "ACIK" : channelEnabled(subject, kind, channel, base).acik;
    if (it.acik === baseOn && scope === null) continue;
    if (channel === "UYGULAMA" && inAppBase.kilit) continue; // kilitli türde açık satır anlamsız
    out.set(key, { kind, channel, row: { enabled: it.acik, scope } });
  }
  return out;
}

/** Tam gövde: kişinin GÖREBİLDİĞİ türlerdeki satırları değiştirir (görünmeyen türün satırı izin dönerse geçerli kalır). */
export async function putPreferences(v: PreferenceViewer, body: unknown) {
  const { tercihler } = PreferencesBody.parse(body);
  const { subject, env, layers } = await context(v);
  const plan = planPreferenceRows(subject, env, layers, tercihler);
  const visible = NOTIFICATION_KINDS.filter((k) => canSeeNotificationType(subject, k, env));
  await prisma.$transaction(async (tx) => {
    await tx.notificationPreference.deleteMany({ where: { userId: v.userId, kind: { in: visible } } });
    if (plan.size > 0) {
      await tx.notificationPreference.createMany({
        data: [...plan.values()].map((p) => ({
          userId: v.userId,
          kind: p.kind,
          channel: p.channel,
          enabled: p.row.enabled,
          scope: p.row.scope ? (p.row.scope as Prisma.InputJsonValue) : Prisma.DbNull,
        })),
      });
    }
  });
  return getPreferences(v);
}

// ---- önizleme (Karar Y3; YAZMAZ) ------------------------------------------

export const PreviewBody = z.object({ tercihler: z.array(PreferenceItem).max(1000).optional() }).strict();

/** "Haftada ~N bildirim": son 30 fabrika günü sayaç × kişinin teslim kararı (taslak verilirse ona göre). */
export async function previewPreferences(v: PreferenceViewer, body: unknown) {
  const { tercihler } = PreviewBody.parse(body ?? {});
  const { subject, env, layers } = await context(v);
  let taslak: Map<string, PreferenceRowView | null> | undefined;
  if (tercihler) {
    taslak = new Map();
    for (const [k, p] of planPreferenceRows(subject, env, layers, tercihler)) taslak.set(k, p.row);
  }
  const today = factoryDayKeyUtcMidnight();
  const since = new Date(today.getTime() - (PREVIEW_DAYS - 1) * DAY_MS);
  const stats = await prisma.notificationDailyStats.findMany({
    where: { factoryDay: { gte: since, lte: today } },
    select: { factoryDay: true, kind: true, events: true },
  });
  const measured = stats.length > 0;
  const first = measured ? Math.min(...stats.map((s) => s.factoryDay.getTime())) : today.getTime();
  const days = Math.min(PREVIEW_DAYS, Math.max(1, Math.round((today.getTime() - first) / DAY_MS) + 1));
  const perKind = new Map<string, number>();
  for (const s of stats) perKind.set(s.kind, (perKind.get(s.kind) ?? 0) + s.events);
  const o = { env, layers, taslak };
  const top: Array<{ kind: NotificationKind; sayi: number }> = [];
  for (const kind of NOTIFICATION_KINDS) {
    const inApp = resolvePreference(subject, kind, "UYGULAMA", o);
    if (inApp.durum === "GIZLI") continue;
    const digest = resolvePreference(subject, kind, "OZET", o);
    if (inApp.durum !== "ACIK" && digest.durum !== "ACIK") continue;
    const weekly = measured ? ((perKind.get(kind) ?? 0) / days) * 7 : getNotificationEntry(kind).tahminiHaftalik;
    const sayi = weekly * (inApp.kapsam ? SCOPE_PREVIEW_FACTOR : 1);
    if (sayi > 0) top.push({ kind, sayi });
  }
  top.sort((a, b) => b.sayi - a.sayi || a.kind.localeCompare(b.kind));
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    haftalik: round(top.reduce((s, t) => s + t.sayi, 0)),
    enCok: top.slice(0, 5).map((t) => ({ kind: t.kind, sayi: round(t.sayi) })),
    kaynak: measured ? ("olcum" as const) : ("tahmin" as const),
  };
}

// ---- varsayılana dön (yıkıcı: önce önizleme, kayıt başına seçim) --------------

export async function resetPreview(v: PreferenceViewer) {
  const rows = await prisma.notificationPreference.findMany({
    where: { userId: v.userId },
    select: { id: true, kind: true, channel: true, enabled: true, scope: true },
    orderBy: [{ kind: "asc" }, { channel: "asc" }],
  });
  return {
    satirlar: rows.map((r) => ({
      id: r.id, tur: r.kind, ad: isKind(r.kind) ? getNotificationEntry(r.kind).ad : r.kind, kanal: r.channel, acik: r.enabled, kapsam: r.scope,
    })),
  };
}

export const ResetBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) }).strict();

/** Yalnız kişinin KENDİ satırları silinir (saf yapılandırma pivotu); başkasının id'si sessizce etkisiz. */
export async function resetPreferences(v: PreferenceViewer, body: unknown) {
  const { ids } = ResetBody.parse(body);
  const r = await prisma.notificationPreference.deleteMany({ where: { userId: v.userId, id: { in: [...new Set(ids)] } } });
  return { silinen: r.count };
}

// ---- ayarlar (sessiz saat, gün özeti saati, ses) ------------------------------

const quietTime = z.string().regex(QUIET_TIME_PATTERN, "Saat SS:DD biçiminde olmalı.").nullable();
export const SettingsBody = z
  .object({
    sessizBaslangic: quietTime,
    sessizBitis: quietTime,
    sessizKanallar: z.array(z.enum(NOTIFICATION_QUIET_CHANNELS, "Sessiz saat bu kanalı susturamaz.")).max(NOTIFICATION_QUIET_CHANNELS.length),
    ozetSaati: z.number().int().min(0, "Özet saati 0–23 olmalı.").max(23, "Özet saati 0–23 olmalı.").nullable(),
    ses: z.boolean(),
  })
  .strict()
  .refine((b) => (b.sessizBaslangic === null) === (b.sessizBitis === null), "Sessiz saatin başlangıcı ve bitişi birlikte verilir.");

function settingsView(s: { quietStart: string | null; quietEnd: string | null; quietChannels: string[]; digestHour: number | null; sound: boolean } | null) {
  return {
    sessizBaslangic: s?.quietStart ?? null,
    sessizBitis: s?.quietEnd ?? null,
    sessizKanallar: s?.quietChannels ?? [],
    ozetSaati: s?.digestHour ?? null,
    ses: s?.sound ?? true,
  };
}

const SETTINGS_SELECT = { quietStart: true, quietEnd: true, quietChannels: true, digestHour: true, sound: true } as const;

export async function getSettings(v: PreferenceViewer) {
  return settingsView(await prisma.notificationUserSetting.findUnique({ where: { userId: v.userId }, select: SETTINGS_SELECT }));
}

export async function putSettings(v: PreferenceViewer, body: unknown) {
  const b = SettingsBody.parse(body);
  const data = {
    quietStart: b.sessizBaslangic,
    quietEnd: b.sessizBitis,
    quietChannels: [...new Set(b.sessizKanallar)],
    digestHour: b.ozetSaati,
    sound: b.ses,
  };
  const row = await prisma.notificationUserSetting.upsert({
    where: { userId: v.userId },
    create: { userId: v.userId, ...data },
    update: data,
    select: SETTINGS_SELECT,
  });
  return settingsView(row);
}

// ---- takip ------------------------------------------------------------------

export const FOLLOW_KINDS = ["siparis", "is-emri", "dokuma-isi"] as const;
export type FollowKind = (typeof FOLLOW_KINDS)[number];

const FOLLOW_PERMISSIONS: Record<FollowKind, readonly string[]> = {
  siparis: ["order:read"],
  "is-emri": ["workorder:read", "mobile:fason-sevk", "mobile:hizli-is-emri"],
  "dokuma-isi": ["weavingorder:read"],
};

/** Kayıt görülemiyorsa (izin/modül/yok) 404 — varlığı sızdırılmaz. */
async function followTargetFor(v: PreferenceViewer, rawKind: string, rawId: string): Promise<FollowTarget> {
  const notFound = () => AppError.notFound("Kayıt bulunamadı.", { code: "FOLLOW_TARGET_NOT_FOUND" });
  if (!(FOLLOW_KINDS as readonly string[]).includes(rawKind)) {
    throw AppError.badRequest("Takip türü: siparis · is-emri · dokuma-isi.", { code: "FOLLOW_KIND_INVALID" });
  }
  if (!z.string().uuid().safeParse(rawId).success) throw AppError.badRequest("Geçersiz kayıt kimliği.", { code: "INVALID_UUID" });
  const kind = rawKind as FollowKind;
  if (!FOLLOW_PERMISSIONS[kind].some((c) => matchesPermission([...v.permissions], c))) throw notFound();
  let exists: { id: string } | null;
  if (kind === "siparis") exists = await prisma.order.findUnique({ where: { id: rawId }, select: { id: true } });
  else if (kind === "is-emri") exists = await prisma.workOrder.findUnique({ where: { id: rawId }, select: { id: true } });
  else {
    if (!(await readDokumaEnabled())) throw notFound();
    exists = await prisma.weavingOrder.findUnique({ where: { id: rawId }, select: { id: true } });
  }
  if (!exists) throw notFound();
  return kind === "siparis" ? { orderId: rawId } : kind === "is-emri" ? { workOrderId: rawId } : { weavingOrderId: rawId };
}

function followWhere(userId: string, t: FollowTarget): Prisma.RecordFollowWhereInput {
  const { column, id } = followTargetOf(t);
  return { userId, [column]: id };
}

async function followState(userId: string, t: FollowTarget) {
  const row = await prisma.recordFollow.findFirst({ where: followWhere(userId, t), select: { state: true, reason: true } });
  return { takip: row?.state === "TAKIP", durum: row?.state ?? null, neden: row?.reason ?? null };
}

export async function getFollow(v: PreferenceViewer, kind: string, id: string) {
  return followState(v.userId, await followTargetFor(v, kind, id));
}

/** Elle takip: satır yoksa TAKIP/ELLE doğar, BIRAKTI ise TAKIP'e döner (atomik; yarışan ikinci istek etkisiz). */
export async function putFollow(v: PreferenceViewer, kind: string, id: string) {
  const t = await followTargetFor(v, kind, id);
  const { column } = followTargetOf(t);
  const resumed = await prisma.recordFollow.updateMany({ where: { ...followWhere(v.userId, t), state: "BIRAKTI" }, data: { state: "TAKIP", reason: "ELLE" } });
  if (resumed.count === 0) {
    const col = Prisma.raw(`"${column}"`);
    await prisma.$executeRaw`
      INSERT INTO record_follows (id, "userId", ${col}, state, reason, "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${v.userId}::uuid, ${followTargetOf(t).id}::uuid, 'TAKIP', 'ELLE', now(), now()) -- tz-ok: record_follows zaman kolonları timestamptz, çıplak now() mutlak anı yazar
      ON CONFLICT ("userId", ${col}) WHERE ${col} IS NOT NULL DO NOTHING`;
  }
  return followState(v.userId, t);
}

/** Bırak = durum geçişi TAKIP → BIRAKTI (silinmez: oluşturan otomatiği bir daha ezmez). */
export async function deleteFollow(v: PreferenceViewer, kind: string, id: string) {
  const t = await followTargetFor(v, kind, id);
  await prisma.recordFollow.updateMany({ where: { ...followWhere(v.userId, t), state: "TAKIP" }, data: { state: "BIRAKTI" } });
  return followState(v.userId, t);
}

/** `GET /katalog` eki: çözülmüş hücreler (durum, kilit, kaynak, kapsam) — eski alanlar korunur. */
export async function catalogCells(v: PreferenceViewer) {
  const { subject, env, layers } = await context(v);
  return resolveAllPreferences(subject, { env, layers });
}

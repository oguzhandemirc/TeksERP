// =============================================================================
// BİLDİRİM TESLİM KARARI — alıcı kaynakları ∪ → görme ∩ → tercih (§5.1) → kapsam → kanal + sessiz saat
// =============================================================================
// Dağıtıcı turunun içinde çağrılır; yazmaz. Donmuş alarm listesi (`LoomAlarmRecipient`) GİRDİDİR,
// değiştirilmez: tercih yalnız o listeden kimin kutusuna satır düşeceğini seçer. Kaynaklar: çözücü
// (IZIN ya da donmuş liste) · TAKIPCI/OLUSTURAN (`record_follows`) · LISTE (fabrika `extraRecipientIds`).
// Açık kaynak (takip/liste/nöbet) katalog düzeyindeki "sana varsayılan değil"i aşar; bilinçli KAPALI'yı
// (fabrika/profil/kullanıcı) aşmaz. Sessiz saat fabrika dilimindedir ve yalnız ses/OS/tablet kanalını
// susturur; gelen kutusu satırı her durumda yazılır; nöbetteki ALARM sessiz saati DELER (Karar Y2).
// =============================================================================
import type { Prisma } from "@prisma/client";
import type { NotificationCatalogEntry, NotificationKind } from "../../constants/notification-catalog";
import { NOTIFICATION_QUIET_CHANNELS, type NotificationScope } from "../../constants/notification-preference";
import { factoryDateTimeTr } from "../../constants/time";
import { resolvePreference, channelEnabled, loadPreferenceLayers, type PreferenceSubject, type PreferenceLayers } from "./notification-preference.helper";
import { visibleUsersFor, type NotificationVisibilityEnv } from "./notification-visibility.helper";

type Tx = Prisma.TransactionClient;
export type DeliveryReason = "IZIN" | "TAKIPCI" | "OLUSTURAN" | "NOBET" | "LISTE" | "ALARM_ALICISI";

/** Aynı kişi birden çok kaynaktan gelirse en özel sebep kalır (nöbet sessiz saati deler, kaybolmamalı). */
const REASON_RANK: Record<DeliveryReason, number> = { NOBET: 6, ALARM_ALICISI: 5, OLUSTURAN: 4, TAKIPCI: 3, LISTE: 2, IZIN: 1 };

/** Outbox `subjectType` → takip hedef kolonu (tek hedef; plan §5.3). */
export const FOLLOW_TARGET_BY_SUBJECT: Readonly<Record<string, "orderId" | "workOrderId" | "weavingOrderId">> = {
  siparis: "orderId",
  order: "orderId",
  isemri: "workOrderId",
  "dokuma-isi": "weavingOrderId",
};

export interface QuietSetting {
  quietStart: string | null;
  quietEnd: string | null;
  quietChannels: readonly string[];
}

export interface DeliveryContext {
  layers: PreferenceLayers;
  settings: ReadonlyMap<string, QuietSetting>;
  now: Date;
  /** "BENIM" istasyon kümesi — yalnız gereken kişi için tembel okunur. */
  myStations: Map<string, ReadonlySet<string>>;
}

export interface Delivery {
  userId: string;
  reason: DeliveryReason;
  ozet: boolean;
  km: boolean;
  kt: boolean;
}

export async function loadDeliveryContext(tx: Tx, userIds: readonly string[], now: Date): Promise<DeliveryContext> {
  const layers = await loadPreferenceLayers(tx, userIds);
  const rows = userIds.length === 0 ? [] : await tx.notificationUserSetting.findMany({
    where: { userId: { in: [...new Set(userIds)] }, quietStart: { not: null } },
    select: { userId: true, quietStart: true, quietEnd: true, quietChannels: true },
  });
  return { layers, settings: new Map(rows.map((r) => [r.userId, r])), now, myStations: new Map() };
}

/** "HH:MM" → dakika. */
const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * `at` anı fabrika duvar saatinde [başlangıç, bitiş) aralığında mı. Bitiş başlangıçtan küçükse aralık
 * gece yarısını aşar (22:00–07:00). Eşit uçlar = boş aralık.
 */
export function inQuietHours(at: Date, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const t = minutes(factoryDateTimeTr(at).slice(-5));
  const s = minutes(start);
  const e = minutes(end);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

function quietMutes(ctx: DeliveryContext, userId: string, channel: "MASAUSTU" | "TABLET_SES"): boolean {
  const q = ctx.settings.get(userId);
  if (!q || !q.quietChannels.includes(channel)) return false;
  return (NOTIFICATION_QUIET_CHANNELS as readonly string[]).includes(channel) && inQuietHours(ctx.now, q.quietStart, q.quietEnd);
}

/** Konunun takipçileri (state=TAKIP): reason OLUSTURAN korunur, ELLE → TAKIPCI. */
export async function subjectFollowers(tx: Tx, subjectType: string, subjectId: string | null): Promise<Array<{ userId: string; reason: DeliveryReason }>> {
  const col = FOLLOW_TARGET_BY_SUBJECT[subjectType];
  if (!col || !subjectId) return [];
  const rows = await tx.recordFollow.findMany({ where: { [col]: subjectId, state: "TAKIP" }, select: { userId: true, reason: true } });
  return rows.map((r) => ({ userId: r.userId, reason: r.reason === "OLUSTURAN" ? "OLUSTURAN" : "TAKIPCI" }));
}

/** Konunun istasyonu (salon) — `istasyonlar` kapsamı için; bilinmiyorsa null (süzgeç iletmez). */
async function subjectStation(tx: Tx, subjectType: string, subjectId: string | null): Promise<string | null> {
  if (!subjectId) return null;
  if (subjectType === "loom_alarm") {
    const a = await tx.loomAlarm.findUnique({ where: { id: subjectId }, select: { machine: { select: { stationId: true } } } });
    return a?.machine.stationId ?? null;
  }
  if (subjectType === "levent") {
    const b = await tx.warpBeam.findUnique({ where: { id: subjectId }, select: { currentMachine: { select: { stationId: true } } } });
    return b?.currentMachine?.stationId ?? null;
  }
  return null;
}

/** "BENIM" = canlı istasyon oturumu ∪ süren vardiyanın salon sorumluluğu (plan §5.2). */
export async function myStationsOf(tx: Tx, userId: string, now: Date): Promise<Set<string>> {
  const out = new Set<string>();
  const sessions = await tx.workSession.findMany({ where: { userId, endedAt: null }, select: { stationId: true } });
  for (const s of sessions) out.add(s.stationId);
  const shifts = await tx.shiftInstance.findMany({
    where: { isCancelled: false, startsAt: { lte: now }, endsAt: { gt: now } },
    select: { shiftDefinitionId: true },
  });
  if (shifts.length > 0) {
    const resp = await tx.hallShiftResponsible.findMany({
      where: { userId, revokedAt: null, shiftDefinitionId: { in: shifts.map((s) => s.shiftDefinitionId) } },
      select: { stationId: true },
    });
    for (const r of resp) out.add(r.stationId);
  }
  return out;
}

/** Türkçe biçimli sayı ("1,5" · "1.234") → number; okunamazsa null. */
export function readMeasure(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/^%/, "").replace(/\./g, "").replace(",", ".");
  if (t === "" || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

interface ScopeInput {
  tx: Tx;
  ctx: DeliveryContext;
  entry: NotificationCatalogEntry;
  row: { subjectType: string; subjectId: string | null; payload: unknown };
  followers: ReadonlySet<string>;
  station: () => Promise<string | null>;
}

/** Kapsam YALNIZ daraltır: her beyanlı anahtar ayrı kapıdır; beyansız anahtar (eski satır) yok sayılır. */
async function scopeAllows(userId: string, scope: NotificationScope, s: ScopeInput): Promise<boolean> {
  const decl = s.entry.kapsam ?? {};
  if (scope.yalnizTakip && decl.yalnizTakip && !s.followers.has(userId)) return false;
  if (scope.istasyonlar && decl.istasyonlar) {
    const st = await s.station();
    if (!st) return false;
    let set: ReadonlySet<string>;
    if (scope.istasyonlar === "BENIM") {
      set = s.ctx.myStations.get(userId) ?? await myStationsOf(s.tx, userId, s.ctx.now);
      s.ctx.myStations.set(userId, set);
    } else set = new Set(scope.istasyonlar);
    if (!set.has(st)) return false;
  }
  for (const [key, value] of Object.entries(scope.esik ?? {})) {
    const measureDecl = decl.esik?.[key];
    if (!measureDecl) continue;
    const m = readMeasure((s.row.payload as Record<string, unknown> | null)?.[measureDecl.alan]);
    if (m === null) return false;
    if (measureDecl.yon === "UST" ? !(m <= value) : !(m > value)) return false;
  }
  return true;
}

export interface DecideInput {
  tx: Tx;
  row: { subjectType: string; subjectId: string | null; payload: unknown; actorUserId: string | null };
  kind: NotificationKind;
  entry: NotificationCatalogEntry;
  env: NotificationVisibilityEnv;
  grants: ReadonlyMap<string, readonly string[]>;
  ctx: DeliveryContext;
}

/**
 * Çözücünün adaylarına (IZIN ya da donmuş liste) takip + liste kaynaklarını ekler, görme süzgeciyle
 * kesiştirir ve kişi başına tercih kararını verir. ALARM'da ek kaynak yoktur (alıcı = donmuş liste).
 */
export async function decideDeliveries(d: DecideInput, candidates: ReadonlyArray<{ userId: string; reason: DeliveryReason }>): Promise<Delivery[]> {
  const { tx, row, kind, entry, env, grants, ctx } = d;
  const isAlarm = entry.sinif === "ALARM";
  const followersList = await subjectFollowers(tx, row.subjectType, row.subjectId);
  const followers = new Set(followersList.map((f) => f.userId));
  const merged = new Map<string, DeliveryReason>();
  const put = (userId: string, reason: DeliveryReason): void => {
    const prev = merged.get(userId);
    if (!prev || REASON_RANK[reason] > REASON_RANK[prev]) merged.set(userId, reason);
  };
  for (const c of candidates) put(c.userId, c.reason);
  if (!isAlarm) {
    const extra = [
      ...followersList,
      ...(ctx.layers.factory.get(kind)?.extraRecipientIds ?? []).map((userId) => ({ userId, reason: "LISTE" as const })),
    ].filter((x) => x.userId !== row.actorUserId);
    if (extra.length > 0) {
      // Kural yetki genişletmez: ek kaynak görme süzgeciyle KESİŞİR.
      const visible = new Set(await visibleUsersFor(tx, kind, env, { grants, userIds: extra.map((x) => x.userId) }));
      for (const x of extra) if (visible.has(x.userId)) put(x.userId, x.reason);
    }
  }
  let stationMemo: Promise<string | null> | null = null;
  const scopeIn: ScopeInput = {
    tx, ctx, entry, row, followers,
    station: () => (stationMemo ??= subjectStation(tx, row.subjectType, row.subjectId)),
  };
  const out: Delivery[] = [];
  for (const [userId, reason] of [...merged].sort((a, b) => a[0].localeCompare(b[0]))) {
    const subject: PreferenceSubject = { userId, permissions: grants.get(userId) ?? [] };
    const nobette = reason === "NOBET";
    const inApp = resolvePreference(subject, kind, "UYGULAMA", { env, layers: ctx.layers, nobette });
    if (inApp.durum === "GIZLI") continue;
    const layerOpt = { layers: ctx.layers };
    const digestOn = channelEnabled(subject, kind, "OZET", layerOpt).acik;
    // Açık kaynak yalnız katalog düzeyindeki "varsayılan değil"i aşar; bilinçli KAPALI'ya saygı.
    const explicit = reason !== "IZIN";
    const deliver = inApp.durum === "ACIK" || digestOn || (explicit && inApp.kaynak === "katalog");
    if (!deliver) continue;
    if (inApp.kapsam && !(await scopeAllows(userId, inApp.kapsam, scopeIn))) continue;
    const digest = inApp.durum !== "ACIK" && digestOn && !(explicit && inApp.kaynak === "katalog");
    const piercesQuiet = isAlarm && nobette;
    const km = channelEnabled(subject, kind, "MASAUSTU", layerOpt).acik && (piercesQuiet || !quietMutes(ctx, userId, "MASAUSTU"));
    const kt = channelEnabled(subject, kind, "TABLET_SES", layerOpt).acik && (piercesQuiet || !quietMutes(ctx, userId, "TABLET_SES"));
    out.push({ userId, reason, ozet: digest, km, kt });
  }
  return out;
}

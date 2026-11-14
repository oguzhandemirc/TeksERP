// =============================================================================
// BİLDİRİM ÖZET ZAMANLAYICISI — özet türleri (katalog `ozet`: SAATLIK · VARDIYA · GUN_SONU), S1 2026-11-14
// =============================================================================
// Yüksek frekanslı olaylar tekil bildirim değil, PENCERE başına tek özet satırıdır (plan K3). Kaynak `compute(pencere)`
// yük döner (null = o pencerede yazılacak bir şey yok). Pencere fabrika diliminden (`constants/time.ts`): saatlik =
// biten fabrika saati, gün sonu = biten fabrika günü, vardiya = biten son vardiya örneği (`shiftInstance`).
// Tekillik: tur tx'inin İLK ifadesi 8040 kilidi `hashtext('bildirim-ozet:'||kind)`; damga `bildirim.ozetDamga.<tür>`
// = son yazılan pencere anahtarı → aynı pencere iki kez yazılmaz (yeniden başlatma ve çift süreç dahil).
// İlk tur (damga yok) yalnız damgayı kurar, bildirim üretmez (açılışta geçmiş pencere seli yok — koşul su damgası emsali).
// Bayrak kapalıyken tur no-op; zamanlayıcıyı `notification-dispatch.job` koşul tarayıcısıyla birlikte açar/kapar.
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { NOTIFICATION_CATALOG, type NotificationKind } from "../constants/notification-catalog";
import { factoryDayStart, factoryYmd } from "../constants/time";
import { NOTIFICATION_DISPATCH_LOCK_NS } from "../services/notification-dispatch.service";
import { emitNotification } from "../services/helpers/notification-emit.helper";
import { readNotificationInboxEnabled } from "../services/system-setting.service";
import { reportJobFailure } from "./job-failure";
import { uyari } from "../lib/logger";

export type DigestCadence = "SAATLIK" | "VARDIYA" | "GUN_SONU";

export interface DigestWindow {
  /** Pencere kimliği (damga + konu anahtarı): saat ISO'su · fabrika günü · vardiya örneği id'si. */
  key: string;
  from: Date;
  to: Date;
  /** Görüntü adı (vardiya adı, gün). */
  label: string;
}

export interface DigestSource {
  kind: NotificationKind;
  /** Pencerenin yükü; null → bu pencere için bildirim yok (damga yine ilerler). */
  compute: (tx: Prisma.TransactionClient, w: DigestWindow) => Promise<Record<string, unknown> | null>;
}

export type DigestRunResult = "disabled" | "no-window" | "already" | "baseline" | "empty" | "emitted";

const HOUR_MS = 3_600_000;
const TICK_MS = 60_000;
const sources = new Map<NotificationKind, DigestSource>();

export const digestStampKey = (kind: string): string => `bildirim.ozetDamga.${kind}`;

/** Kaynak kaydı; yalnız katalogda `ozet` beyanlı tür. */
export function registerDigestSource(src: DigestSource): void {
  if (!NOTIFICATION_CATALOG[src.kind] || !("ozet" in NOTIFICATION_CATALOG[src.kind])) throw new Error(`özet kaynağı yalnız özet türü olabilir: ${src.kind}`);
  sources.set(src.kind, src);
}

export function registeredDigestKinds(): NotificationKind[] {
  return [...sources.keys()];
}

function cadenceOf(kind: NotificationKind): DigestCadence {
  return (NOTIFICATION_CATALOG[kind] as { ozet?: DigestCadence }).ozet!;
}

/** `now` anında BİTMİŞ en son pencere (fabrika dilimi). Vardiya tanımı yoksa null. */
export async function lastClosedWindow(db: Pick<Prisma.TransactionClient, "shiftInstance">, cadence: DigestCadence, now: Date): Promise<DigestWindow | null> {
  if (cadence === "GUN_SONU") {
    const to = factoryDayStart(now);
    const from = factoryDayStart(new Date(to.getTime() - HOUR_MS));
    const gun = factoryYmd(from);
    return { key: gun, from, to, label: gun };
  }
  if (cadence === "SAATLIK") {
    const day = factoryDayStart(now);
    const to = new Date(day.getTime() + Math.floor((now.getTime() - day.getTime()) / HOUR_MS) * HOUR_MS);
    const from = new Date(to.getTime() - HOUR_MS);
    return { key: from.toISOString(), from, to, label: from.toISOString() };
  }
  const s = await db.shiftInstance.findFirst({
    where: { endsAt: { lte: now }, isCancelled: false },
    orderBy: { endsAt: "desc" },
    select: { id: true, startsAt: true, endsAt: true, shiftDefinition: { select: { name: true } } },
  });
  return s ? { key: s.id, from: s.startsAt, to: s.endsAt, label: s.shiftDefinition.name } : null;
}

/** Bir özet türünün TEK turu (bekçi doğrudan çağırır; `now` enjekte edilebilir). */
export async function runDigestOnce(kind: NotificationKind, now: Date = new Date()): Promise<DigestRunResult> {
  const src = sources.get(kind);
  if (!src) throw new Error(`kayıtlı özet kaynağı yok: ${kind}`);
  if (!(await readNotificationInboxEnabled())) return "disabled";
  return prisma.$transaction(async (tx): Promise<DigestRunResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NOTIFICATION_DISPATCH_LOCK_NS}::int, hashtext(${"bildirim-ozet:" + kind}))`;
    if (!(await readNotificationInboxEnabled(tx))) return "disabled";
    const w = await lastClosedWindow(tx, cadenceOf(kind), now);
    if (!w) return "no-window";
    const key = digestStampKey(kind);
    const stamp = await tx.systemSetting.findUnique({ where: { key }, select: { value: true } });
    if (stamp?.value === w.key) return "already";
    await tx.systemSetting.upsert({
      where: { key },
      create: { key, value: w.key, description: "Bildirim özet damgası: son yazılan pencere (aynı pencere iki kez yazılmaz)" },
      update: { value: w.key },
    });
    if (stamp === null) return "baseline";
    const payload = await src.compute(tx, w);
    if (!payload) return "empty";
    await emitNotification(tx, kind, { type: "digest", id: null, key: w.key }, payload, {});
    return "emitted";
  });
}

// ── Zamanlayıcı: dakikada bir tur; tur üst üste binmez ─────────────────────
let timer: NodeJS.Timeout | null = null;
const running = new Set<NotificationKind>();

function tick(): void {
  for (const kind of sources.keys()) {
    if (running.has(kind)) continue;
    running.add(kind);
    void runDigestOnce(kind)
      .catch((err) => { uyari("bildirim", `özet ${kind} yazılamadı`, err); reportJobFailure(`bildirim-ozet:${kind}`, err); })
      .finally(() => running.delete(kind));
  }
}

export function startNotificationDigestScheduler(): void {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  timer.unref();
  setImmediate(tick);
}

export function stopNotificationDigestScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

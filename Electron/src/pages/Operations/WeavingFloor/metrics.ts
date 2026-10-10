// =============================================================================
// SÜRE · KADEME · ÖZET — saf hesaplar (bileşen değil; birim testli)
// =============================================================================
import { ESCALATION_SETTINGS, reasonOf } from "./stopReasons";
import type { LiveLoom, OpenStop } from "./types";

const MINUTE = 60_000;
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Büyük sayaç metni: bir saatin altında `DD:SS` (canlı akar), üstünde `S sa DD dk`.
 * Negatif/NaN girdi 00:00'a düşer (saat kayması ekranda eksi süre göstermez).
 */
export function formatTimer(ms: number): string {
  const sec = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  if (sec < 3600) return `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`;
  const min = Math.floor(sec / 60);
  return `${Math.floor(min / 60)} sa ${pad2(min % 60)} dk`;
}

/** Kısa süre metni (özet ve listeler): `45 dk`, `1 sa 05 dk`, bir dakikanın altı `<1 dk`. */
export function formatShortDuration(ms: number): string {
  const min = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / MINUTE) : 0;
  if (min < 1) return "<1 dk";
  if (min < 60) return `${min} dk`;
  return `${Math.floor(min / 60)} sa ${pad2(min % 60)} dk`;
}

/**
 * Duruşun uyarı kademesi:
 * - `UNTRACKED` plan dışı duruş (hedef süresi yok),
 * - `WITHIN` hedef süre içinde,
 * - `OVERDUE` hedef aşıldı, patrona iletim payı işliyor (pay 0 ise anlıktır),
 * - `ESCALATED` patrona iletildi.
 */
export type EscalationTier = "UNTRACKED" | "WITHIN" | "OVERDUE" | "ESCALATED";

export function escalationTierOf(stop: OpenStop, now: number): EscalationTier {
  const target = reasonOf(stop.reasonCode).targetMin;
  if (target === null) return "UNTRACKED";
  if (stop.escalatedAt !== null && stop.escalatedAt <= now) return "ESCALATED";
  return now - stop.startedAt >= target * MINUTE ? "OVERDUE" : "WITHIN";
}

export const isPastTarget = (tier: EscalationTier): boolean => tier === "OVERDUE" || tier === "ESCALATED";

/** Hedefin ne kadarı tüketildi (0..1, aşınca 1'de kalır) — sayaç halkası. */
export function targetProgress(stop: OpenStop, now: number): number {
  const target = reasonOf(stop.reasonCode).targetMin;
  if (!target) return 0;
  return Math.min(1, Math.max(0, (now - stop.startedAt) / (target * MINUTE)));
}

/** Patrona iletimin olması gereken an (hedef + pay); süre izlenmeyen duruşta null. */
export function escalationDueAt(stop: OpenStop, graceMin = ESCALATION_SETTINGS.graceMin): number | null {
  const target = reasonOf(stop.reasonCode).targetMin;
  return target === null ? null : stop.startedAt + (target + graceMin) * MINUTE;
}

/** Patrona iletimin zamanı geldi mi (hedef + pay) ve henüz iletilmedi mi. */
export function shouldEscalate(stop: OpenStop, now: number, graceMin = ESCALATION_SETTINGS.graceMin): boolean {
  if (stop.escalatedAt !== null) return false;
  const due = escalationDueAt(stop, graceMin);
  return due !== null && now >= due;
}

/** Çalışma oranı (kullanılabilirlik) 0..100; planlı süre yoksa null = ölçülemedi. */
export function availabilityPct(t: LiveLoom): number | null {
  if (t.shift.plannedSec <= 0) return null;
  return Math.round((t.shift.runSec / t.shift.plannedSec) * 100);
}

/** Bugünkü çalışma oranı 0..100 (fabrika günü başından beri) — kartın "bugün %"i. */
export function todayAvailabilityPct(t: LiveLoom): number | null {
  if (t.today.plannedSec <= 0) return null;
  return Math.round((t.today.runSec / t.today.plannedSec) * 100);
}

/** Hız oranı (performans) 0..100 — çalışırken hedef devire göre. */
export function performancePct(t: LiveLoom): number | null {
  if (t.shift.runSec <= 0 || t.targetRpm <= 0) return null;
  const expected = (t.shift.runSec / 60) * t.targetRpm;
  return Math.min(100, Math.round((t.shift.picks / expected) * 100));
}

export interface FloorSummaryData {
  total: number;
  running: number;
  stopped: number;
  overdue: number;
  /** Şu an çalışan tezgah oranı 0..100 (üst şeridin "şu an %"i); tezgah yoksa null. */
  runningNowPct: number | null;
  /** Bugünkü çalışma oranı 0..100 (günün toplam çalışılan / planlı süresi). */
  todayPct: number | null;
  meters: number;
  targetMeters: number;
}

export function summarizeFloor(looms: readonly LiveLoom[], now: number): FloorSummaryData {
  let runSec = 0;
  let plannedSec = 0;
  let meters = 0;
  let targetMeters = 0;
  let overdue = 0;
  let stopped = 0;
  for (const t of looms) {
    runSec += t.today.runSec;
    plannedSec += t.today.plannedSec;
    meters += t.shift.meters;
    targetMeters += t.shift.targetMeters;
    if (t.openStop) {
      stopped += 1;
      if (isPastTarget(escalationTierOf(t.openStop, now))) overdue += 1;
    }
  }
  return {
    total: looms.length,
    running: looms.length - stopped,
    stopped,
    overdue,
    runningNowPct: looms.length > 0 ? Math.round(((looms.length - stopped) / looms.length) * 100) : null,
    todayPct: plannedSec > 0 ? Math.round((runSec / plannedSec) * 100) : null,
    meters: Math.round(meters),
    targetMeters: Math.round(targetMeters),
  };
}

/** Hedef süreyi aşan duruşlar, en uzun bekleyen başta. */
export function overdueLooms(looms: readonly LiveLoom[], now: number): LiveLoom[] {
  return looms
    .filter((t) => t.openStop !== null && isPastTarget(escalationTierOf(t.openStop, now)))
    .sort((a, b) => a.openStop!.startedAt - b.openStop!.startedAt);
}

/** Vardiyanın en yüksek çalışma oranlı tezgahı (eşitlikte metre); rozet tek tezgaha gider. */
export function shiftStarLoom(looms: readonly LiveLoom[]): string | null {
  let best: LiveLoom | null = null;
  let bestScore = -1;
  for (const t of looms) {
    const pct = availabilityPct(t);
    if (pct === null) continue;
    const score = pct * 10_000 + t.shift.meters;
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best?.id ?? null;
}

/** Metre ve atkı biçimi — saat değil, sayı (tr-TR binlik ayırıcı). */
export const formatNumber = (n: number): string => Math.round(n).toLocaleString("tr-TR");

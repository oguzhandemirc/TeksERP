// =============================================================================
// SÜRE · KADEME · ÖZET — saf hesaplar (bileşen değil; birim testli)
// =============================================================================
import type { BeamState, LiveLoom, OpenStop, StopTotal } from "./types";

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
 * - `UNTRACKED` hedef süresi yok (plan dışı ya da sebebe hedef girilmemiş),
 * - `WITHIN` hedef süre içinde,
 * - `OVERDUE` hedef aşıldı, patrona iletim payı işliyor (pay 0 ise anlıktır),
 * - `ESCALATED` patrona iletildi.
 */
export type EscalationTier = "UNTRACKED" | "WITHIN" | "OVERDUE" | "ESCALATED";

/** Hedef ve pay DURUŞA DONMUŞ değerlerdir (sunucu açılış/sebep kararında yazar) — katalogdan okunmaz. */
export function escalationTierOf(stop: OpenStop, now: number): EscalationTier {
  const target = stop.targetMin;
  if (target === null) return "UNTRACKED";
  if (stop.escalatedAt !== null && stop.escalatedAt <= now) return "ESCALATED";
  return now - stop.startedAt >= target * MINUTE ? "OVERDUE" : "WITHIN";
}

export const isPastTarget = (tier: EscalationTier): boolean => tier === "OVERDUE" || tier === "ESCALATED";

/** Hedefin ne kadarı tüketildi (0..1, aşınca 1'de kalır) — sayaç halkası. */
export function targetProgress(stop: OpenStop, now: number): number {
  const target = stop.targetMin;
  if (!target) return 0;
  return Math.min(1, Math.max(0, (now - stop.startedAt) / (target * MINUTE)));
}

/** Patrona iletimin olması gereken an (hedef + pay); süre izlenmeyen duruşta null. */
export function escalationDueAt(stop: OpenStop, graceMin = stop.graceMin): number | null {
  const target = stop.targetMin;
  return target === null ? null : stop.startedAt + (target + graceMin) * MINUTE;
}

/** Patrona iletimin zamanı geldi mi (hedef + pay) ve henüz iletilmedi mi. */
export function shouldEscalate(stop: OpenStop, now: number, graceMin = stop.graceMin): boolean {
  if (stop.escalatedAt !== null) return false;
  const due = escalationDueAt(stop, graceMin);
  return due !== null && now >= due;
}

/** Çalışma oranı (kullanılabilirlik) 0..100; planlı süre yoksa null = ölçülemedi. */
export function availabilityPct(t: LiveLoom): number | null {
  if (!t.shift || t.shift.plannedSec <= 0) return null;
  return Math.round((t.shift.runSec / t.shift.plannedSec) * 100);
}

/** Bugünkü çalışma oranı 0..100 (fabrika günü başından beri) — kartın "bugün %"i. */
export function todayAvailabilityPct(t: LiveLoom): number | null {
  if (t.today.plannedSec <= 0) return null;
  return Math.round((t.today.runSec / t.today.plannedSec) * 100);
}

/** Hız oranı (performans) 0..100 — çalışırken hedef devire göre. */
export function performancePct(t: LiveLoom): number | null {
  if (!t.shift || t.shift.runSec <= 0 || !t.targetRpm || t.targetRpm <= 0) return null;
  const expected = (t.shift.runSec / 60) * t.targetRpm;
  return Math.min(100, Math.round((t.shift.picks / expected) * 100));
}

export interface FloorSummaryData {
  total: number;
  /** İzlenen tezgah adedi — "şu an %"in paydası. */
  monitored: number;
  running: number;
  stopped: number;
  /** İzleme kapalı tezgah — çalışıyor da duruyor da sayılmaz. */
  unmonitored: number;
  overdue: number;
  /** Şu an çalışan tezgah oranı 0..100 (çalışan / izlenen); izlenen yoksa null. */
  runningNowPct: number | null;
  /** Bugünkü çalışma oranı 0..100 (günün toplam çalışılan / planlı süresi). */
  todayPct: number | null;
  /** Vardiya metresi — sayaç telemetrisi olan tezgah yoksa null. */
  meters: number | null;
  targetMeters: number | null;
}

export function summarizeFloor(looms: readonly LiveLoom[], now: number): FloorSummaryData {
  let runSec = 0;
  let plannedSec = 0;
  let meters: number | null = null;
  let targetMeters: number | null = null;
  let overdue = 0;
  let stopped = 0;
  let monitored = 0;
  for (const t of looms) {
    // İzlenmeyen tezgah hiçbir orana girmez (sunucu `countFloor` aynası).
    if (!t.monitored) continue;
    monitored += 1;
    runSec += t.today.runSec;
    plannedSec += t.today.plannedSec;
    if (t.shift) {
      meters = (meters ?? 0) + t.shift.meters;
      targetMeters = (targetMeters ?? 0) + t.shift.targetMeters;
    }
    if (t.openStop) {
      stopped += 1;
      if (isPastTarget(escalationTierOf(t.openStop, now))) overdue += 1;
    }
  }
  return {
    total: looms.length,
    monitored,
    running: monitored - stopped,
    stopped,
    unmonitored: looms.length - monitored,
    overdue,
    runningNowPct: monitored > 0 ? Math.round(((monitored - stopped) / monitored) * 100) : null,
    todayPct: plannedSec > 0 ? Math.round((runSec / plannedSec) * 100) : null,
    meters: meters === null ? null : Math.round(meters),
    targetMeters: targetMeters === null ? null : Math.round(targetMeters),
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
    const score = pct * 10_000 + (t.shift?.meters ?? 0);
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best?.id ?? null;
}

/**
 * Sebebe göre duruş toplamı, en uzun başta: sunucunun gün kırılımı varsa o (bugünün
 * tamamı), yoksa kapanmış duruşlar + açık duruşun şimdiye kadarki süresi (önizleme).
 */
export function stopTotalsOf(t: LiveLoom, now: number): StopTotal[] {
  if (t.dayBreakdown) return [...t.dayBreakdown].sort((a, b) => b.ms - a.ms);
  const totals = new Map<string, StopTotal>();
  const add = (s: { reasonCode: string | null; label: string; lossClass: StopTotal["lossClass"] }, ms: number) => {
    const key = s.reasonCode ?? "";
    const e = totals.get(key) ?? { reasonCode: s.reasonCode, label: s.label, lossClass: s.lossClass, count: 0, ms: 0 };
    totals.set(key, { ...e, count: e.count + 1, ms: e.ms + ms });
  };
  for (const d of t.stops) add(d, d.endedAt - d.startedAt);
  if (t.openStop) add(t.openStop, now - t.openStop.startedAt);
  return [...totals.values()].sort((a, b) => b.ms - a.ms);
}

/** Metre ve atkı biçimi — saat değil, sayı (tr-TR binlik ayırıcı). */
export const formatNumber = (n: number): string => Math.round(n).toLocaleString("tr-TR");

/** Kalan iplik bu oranın altına inince levent uyarı rengine döner. */
export const LOW_BEAM_RATIO = 0.08;

/** Kalan / plan uzunluğu (0..1); payda yoksa null — oran uydurulmaz. */
export function beamRatioOf(b: BeamState): number | null {
  if (b.totalM === null || b.totalM <= 0) return null;
  return Math.min(1, Math.max(0, b.remainingM / b.totalM));
}

/** Kartın gösterdiği levent: kalanı en az olan (ilk bitecek); eşitlikte küçük yuva. */
export function criticalBeamOf(beams: readonly BeamState[]): BeamState | null {
  let best: BeamState | null = null;
  for (const b of beams) if (best === null || b.remainingM < best.remainingM) best = b;
  return best;
}

/** Figürdeki levent kalınlığı: ilk bitecek leventin oranı; levent yoksa ya da oran yoksa 0. */
export function figureBeamRatio(t: LiveLoom): number {
  const b = criticalBeamOf(t.beams);
  return b ? (beamRatioOf(b) ?? 0) : 0;
}

export function isBeamLow(b: BeamState): boolean {
  const r = beamRatioOf(b);
  return r !== null && r < LOW_BEAM_RATIO;
}

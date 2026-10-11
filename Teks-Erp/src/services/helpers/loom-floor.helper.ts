// =============================================================================
// TEZGAH SALONU — saf hesaplar (DB'siz): duruş kademesi · salon/hol özeti
// =============================================================================
// Ekranın üç yüzdesi karıştırılmaz (DOKUMA-CANLI-EKRAN §2): kart/hol "bugün %" = SÜRE
// payı (APT/POT, oran `loom-efficiency.helper`ın tek yazarından) · şerit "şu an %" =
// ADET payı (şu an çalışan / durumu bilinen tezgah). İstemci yalnız gösterir.
// Durum iki kaynaktan boyanır ve kaynak cevapta yazılır (`stateSource`, karne kovası):
// sensörlü (`monitoringState = LIVE`) tezgah "ölçülen"; sensörsüz tezgah günün elle
// kayıtlarından (duruş · koşum · indirme) "elle". Kaydı olmayan sensörsüz tezgah bilinmez.
// =============================================================================
import type { MachineDataSource, MachineMonitoringState, MachineStopLossClass } from "@prisma/client";
import { aggregateMachineKpis, type LoomKpiTerms } from "./loom-efficiency.helper";
import { sourceBucketOf, type SourceBucket } from "./loom-shift-terms.helper";

/** Okumada hesaplanan kademe — süre saatinden (duruşa donmuş hedef + pay). */
export type LoomStopClockTier = "UNTRACKED" | "WITHIN" | "OVERDUE";
/** Ekrana giden kademe: `ESCALATED` yalnız alarm motoru üst kademeyi (K2) ÇALDIRDIYSA — defterden, saatten değil. */
export type LoomStopTier = LoomStopClockTier | "ESCALATED";

export interface StopClock {
  startedAt: Date;
  /** Etkin hedef (dk; `stopTargetMinutes`); NULL = süre izlenmez. */
  targetMinutes: number | null;
  /** Duruşa donmuş pay (dk). */
  graceMinutes: number;
  lossClass: MachineStopLossClass | null;
}

const MIN_MS = 60_000;

/**
 * Etkin hedef — TEK yer (Tezgah Salonu ve alarm motoru aynı fonksiyon): duruşa donmuş sebep hedefi;
 * sebep HİÇ seçilmemişse fabrikanın sebepsiz duruş hedefi (`tezgah.alarm.unclassifiedTargetMinutes`,
 * boş = izlenmez). Sebep seçilmiş ama hedefsizse izlenmez.
 */
export function stopTargetMinutes(stop: { targetMinutes: number | null; reasonCode: string | null }, unclassifiedTargetMinutes: number | null): number | null {
  if (stop.targetMinutes !== null) return stop.targetMinutes;
  return stop.reasonCode === null ? unclassifiedTargetMinutes : null;
}

/** Plan dışı duruş ve hedefsiz sebep süre izlemez. */
function isTracked(s: StopClock): s is StopClock & { targetMinutes: number } {
  return s.targetMinutes !== null && s.lossClass !== "NON_SCHEDULED";
}

/** Hedefin aşıldığı an (K1 = başlangıç + hedef); süre izlenmiyorsa null. */
export function overdueAt(s: StopClock): Date | null {
  return isTracked(s) ? new Date(s.startedAt.getTime() + s.targetMinutes * MIN_MS) : null;
}

/** Üst kademeye iletimin olması gereken an (K2 = başlangıç + hedef + pay); süre izlenmiyorsa null. */
export function escalationDueAt(s: StopClock): Date | null {
  return isTracked(s) ? new Date(s.startedAt.getTime() + (s.targetMinutes + s.graceMinutes) * MIN_MS) : null;
}

/** Hedef dolunca (sınır dahil) OVERDUE. */
export function loomStopTier(s: StopClock, now: Date): LoomStopClockTier {
  const due = overdueAt(s);
  if (due === null) return "UNTRACKED";
  return now.getTime() >= due.getTime() ? "OVERDUE" : "WITHIN";
}

// ── Alarm kademeleri (motor ile ekran AYNI vadeyi okur) ──────────────────────
export type AlarmTier = 1 | 2;

export interface AlarmSchedule {
  k1DueAt: Date;
  /** NULL = üst kademe yok (sebep hedefsiz bir sebebe çevrildi). */
  k2DueAt: Date | null;
}

/** Kademe planı — süre izlenmiyorsa alarm doğmaz (null). */
export function alarmScheduleOf(s: StopClock): AlarmSchedule | null {
  const k1DueAt = overdueAt(s);
  return k1DueAt === null ? null : { k1DueAt, k2DueAt: escalationDueAt(s) };
}

/**
 * Vadesi geçmiş ama henüz çalmamış kademeler: yalnız EN YÜKSEĞİ çalar, alttakiler ATLANIR (geç girilen
 * kayıt ve sunucu yeniden başlaması sağanak üretmesin). `rungTier` = çalmış/atlanmış en yüksek kademe (0 = yok).
 */
export function dueAlarmTiers(schedule: AlarmSchedule, rungTier: number, now: Date): { raise: AlarmTier | null; skip: AlarmTier[] } {
  const due: AlarmTier[] = [];
  if (rungTier < 1 && schedule.k1DueAt.getTime() <= now.getTime()) due.push(1);
  if (rungTier < 2 && schedule.k2DueAt !== null && schedule.k2DueAt.getTime() <= now.getTime()) due.push(2);
  if (due.length === 0) return { raise: null, skip: [] };
  return { raise: due[due.length - 1]!, skip: due.slice(0, -1) };
}

/** Vardiya dışı süzgeci: duruşu kapsayan vardiya yoksa ya da iptal edilmişse alarm doğmaz (tezgah planlı çalışmıyor). */
export function alarmShiftEligible(shift: { isCancelled: boolean } | null): boolean {
  return shift !== null && !shift.isCancelled;
}

/** Ekran kademesi: canlı alarm varsa çaldığı kademe saatin önüne geçer (çalmış kademe "ne oldu"dur). */
export function floorStopTier(clockTier: LoomStopClockTier, alarm: { tier: number } | null): LoomStopTier {
  if (alarm === null) return clockTier;
  return alarm.tier >= 2 ? "ESCALATED" : "OVERDUE";
}

export type FloorLoomState = "RUNNING" | "STOPPED" | "UNMONITORED";

/**
 * Kartın durum kaynağı. `daySource` = günün karne kaynağı (`computeShiftTermsPure().source`):
 * gözlem yoksa INFERRED → "cikarim". Simülasyon beyanı her zaman öne geçer.
 */
export function floorStateSourceOf(monitoringState: MachineMonitoringState, daySource: MachineDataSource): SourceBucket {
  const bucket = sourceBucketOf(daySource);
  if (bucket === "simule") return bucket;
  return monitoringState === "LIVE" ? "olculen" : bucket;
}

/** Durumu bilinmeyen tezgah (sensörsüz ve bugün kaydı yok) gri kalır; açık duruş yoksa çalışıyor. */
export function loomStateOf(stateSource: SourceBucket, hasOpenStop: boolean): FloorLoomState {
  if (stateSource === "cikarim") return "UNMONITORED";
  return hasOpenStop ? "STOPPED" : "RUNNING";
}

/** Özetin girdisi — tezgah başına; `terms` günün APT/POT terimleri. */
export interface FloorLoomCore {
  hallId: string;
  hallName: string;
  state: FloorLoomState;
  openStop: { lossClass: MachineStopLossClass | null; tier: LoomStopTier } | null;
  terms: LoomKpiTerms;
}

export type StoppedClassKey = "UNPLANNED" | "SETUP" | "PLANNED" | "NON_SCHEDULED" | "UNCLASSIFIED";

export interface FloorCounts {
  total: number;
  /** Durumu bilinen tezgah (ölçülen ∪ elle ∪ simüle) — `UNMONITORED` olmayan. */
  monitored: number;
  running: number;
  stopped: number;
  unmonitored: number;
  /** Hedefi aşmış açık duruş sayısı (izlenen tezgahlarda). */
  overdue: number;
  stoppedByClass: Record<StoppedClassKey, number>;
  /** ŞU AN % — çalışan izlenen tezgah / izlenen tezgah (0..100, tam sayı); izlenen yoksa null. */
  nowPct: number | null;
  /** BUGÜN % — izlenen tezgahların Σ APT / Σ POT'u (0..100); ölçülemezse null. */
  todayPct: number | null;
}

export interface FloorHallSummary extends FloorCounts {
  hallId: string;
  hallName: string;
}

function emptyByClass(): Record<StoppedClassKey, number> {
  return { UNPLANNED: 0, SETUP: 0, PLANNED: 0, NON_SCHEDULED: 0, UNCLASSIFIED: 0 };
}

/** Sınıfsız (MINOR dahil — sebep sınıfı olamaz) açık duruş UNCLASSIFIED kovasına düşer. */
function classKey(c: MachineStopLossClass | null): StoppedClassKey {
  if (c === "UNPLANNED" || c === "SETUP" || c === "PLANNED" || c === "NON_SCHEDULED") return c;
  return "UNCLASSIFIED";
}

/** Sayılar ve iki yüzde — salon ve hol AYNI fonksiyondan (tek toplayıcı). */
export function countFloor(looms: readonly FloorLoomCore[]): FloorCounts {
  const byClass = emptyByClass();
  let running = 0;
  let stopped = 0;
  let unmonitored = 0;
  let overdue = 0;
  const monitoredTerms: LoomKpiTerms[] = [];
  for (const l of looms) {
    if (l.state === "UNMONITORED") {
      unmonitored += 1;
      continue;
    }
    monitoredTerms.push(l.terms);
    if (l.state === "RUNNING") {
      running += 1;
      continue;
    }
    stopped += 1;
    byClass[classKey(l.openStop?.lossClass ?? null)] += 1;
    if (l.openStop?.tier === "OVERDUE" || l.openStop?.tier === "ESCALATED") overdue += 1;
  }
  const monitored = running + stopped;
  const agg = aggregateMachineKpis(monitoredTerms);
  return {
    total: looms.length,
    monitored,
    running,
    stopped,
    unmonitored,
    overdue,
    stoppedByClass: byClass,
    nowPct: monitored > 0 ? Math.round((running * 100) / monitored) : null,
    todayPct: agg.availabilityPct,
  };
}

/** Hol (istasyon) kırılımı — hol adı sırasıyla. */
export function summarizeHalls(looms: readonly FloorLoomCore[]): FloorHallSummary[] {
  const groups = new Map<string, { name: string; looms: FloorLoomCore[] }>();
  for (const l of looms) {
    const g = groups.get(l.hallId) ?? { name: l.hallName, looms: [] };
    g.looms.push(l);
    groups.set(l.hallId, g);
  }
  return [...groups.entries()]
    .map(([hallId, g]) => ({ hallId, hallName: g.name, ...countFloor(g.looms) }))
    .sort((a, b) => a.hallName.localeCompare(b.hallName, "tr"));
}

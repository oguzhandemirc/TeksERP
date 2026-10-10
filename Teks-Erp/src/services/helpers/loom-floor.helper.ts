// =============================================================================
// TEZGAH SALONU — saf hesaplar (DB'siz): duruş kademesi · salon/hol özeti
// =============================================================================
// Ekranın üç yüzdesi karıştırılmaz (DOKUMA-CANLI-EKRAN §2): kart/hol "bugün %" = SÜRE
// payı (APT/POT, oran `loom-efficiency.helper`ın tek yazarından) · şerit "şu an %" =
// ADET payı (şu an çalışan izlenen tezgah / izlenen tezgah). İstemci yalnız gösterir.
// Yalnız İZLENEN (`monitoringState = LIVE`) tezgah çalışıyor/duruyor sayılır; izlenmeyen
// tezgahın sayacı elle girişten türer ve "kaç dakikadır" sorusuna doğru cevap veremez.
// =============================================================================
import type { MachineStopLossClass } from "@prisma/client";
import { aggregateMachineKpis, type LoomKpiTerms } from "./loom-efficiency.helper";

/** Açık duruşun hedef kademesi — patrona İLETİM bu dilimde yok; yalnız süre ölçülür. */
export type LoomStopTier = "UNTRACKED" | "WITHIN" | "OVERDUE";

export interface StopClock {
  startedAt: Date;
  /** Duruşa donmuş hedef (dk); NULL = süre izlenmez. */
  targetMinutes: number | null;
  /** Duruşa donmuş pay (dk). */
  graceMinutes: number;
  lossClass: MachineStopLossClass | null;
}

const MIN_MS = 60_000;

/** Plan dışı duruş ve hedefsiz sebep süre izlemez; hedef dolunca OVERDUE. */
export function loomStopTier(s: StopClock, now: Date): LoomStopTier {
  if (s.targetMinutes === null || s.lossClass === "NON_SCHEDULED") return "UNTRACKED";
  return now.getTime() - s.startedAt.getTime() >= s.targetMinutes * MIN_MS ? "OVERDUE" : "WITHIN";
}

/** Patrona iletimin olması gereken an (başlangıç + hedef + pay); süre izlenmiyorsa null. */
export function escalationDueAt(s: StopClock): Date | null {
  if (s.targetMinutes === null || s.lossClass === "NON_SCHEDULED") return null;
  return new Date(s.startedAt.getTime() + (s.targetMinutes + s.graceMinutes) * MIN_MS);
}

export type FloorLoomState = "RUNNING" | "STOPPED" | "UNMONITORED";

export function loomStateOf(monitored: boolean, hasOpenStop: boolean): FloorLoomState {
  if (!monitored) return "UNMONITORED";
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
    if (l.openStop?.tier === "OVERDUE") overdue += 1;
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

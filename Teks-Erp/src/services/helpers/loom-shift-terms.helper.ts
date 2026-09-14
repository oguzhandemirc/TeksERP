// =============================================================================
// VARDİYA KARNESİ TERİMLERİ — TEK HELPER, SAF (DOKUMA-RAPOR-BACKEND-TASARIM-OZETI §3)
// =============================================================================
// Girdi: vardiya penceresi + makinenin o pencereyle KESİŞEN duruşları / koşumları /
// indirmeleri + künye. Çıktı: SANİYE ve ATKI terimleri (oran DEĞİL — oranlar
// `loom-efficiency.helper`), sebep kırılımı, kaynak beyanı, uyarılar.
//
// Kurallar (her biri bekçili — `test_machine_shift_terms`):
//   • Duruş PENCEREYE KIRPILIR (`clipToWindow`): 23:50 başlayan 12 saatlik duruş ilk
//     vardiyaya yalnız 10 dk yazar. Açık duruş `now`a kadar sayılır + uyarı.
//   • KOVA = `lossClass`: NON_SCHEDULED → hiçbir paydada yok · PLANNED → POT'tan
//     düşer · SETUP/UNPLANNED → kullanılabilirlik kaybı · sınıfsız → UNPLANNED
//     (kötümser) + `unclassifiedSec`. MINOR SÜRE sınıfıdır: `durationSec < eşik` ve
//     sınıfı UNPLANNED/SETUP/sınıfsız olan KAPALI duruş; APT'den düşülmez.
//   • POT = takvim − gözlenmemiş(0, Faz 1b beyanı) − NON_SCHEDULED − planlı mola.
//     APT = POT − SETUP − PLANNED − UNPLANNED.
//   • Atkı: Σ `picksAtClose` KOŞUMUN KAPANDIĞI vardiyaya, orantılama YOK (1e hükmü ④);
//     açık koşum katılmaz + uyarı. Kapasite: Σ target_i × (koşum ∩ pencere)nin POT/APT
//     dakikası; target_i = koşum hedefi ?? künye nominal ?? ÖLÇÜLEMEDİ (kapasiteye
//     girmez + uyarı). Planlı mola koşumlara PENCERE PAYIYLA dağıtılır (tek tam koşumda
//     birebir) — ölçülmüş bir şey değil, takvim kuralı.
//   • BOŞ TEZGAH: koşum ∧ duruş ∧ doff yok ⇒ nonScheduledSec = takvim, source INFERRED.
//   • `source` önceliği (`resolveShiftSource`): SIMULATED > SUPERVISOR > OPERATOR > INFERRED.
// =============================================================================
import type { MachineDataSource, MachineMonitoringState, MachineStopLossClass } from "@prisma/client";

export interface ShiftWindow { startsAt: Date; endsAt: Date }

export interface ShiftStopInput {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  reasonCode: string | null;
  reasonLabel: string | null;
  lossClass: MachineStopLossClass | null;
  beamSlot: number | null;
  source: MachineDataSource;
}
export interface ShiftRunInput {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  picksAtClose: number | null;
  producedM: number | null;
  targetPicksPerMin: number | null;
  unitsPerCm: number | null;
}
export interface ShiftTermsInput {
  window: ShiftWindow & { isCancelled: boolean; plannedBreakMinutes: number };
  stops: ShiftStopInput[];
  runs: ShiftRunInput[];
  doffSources: MachineDataSource[];
  spec: { nominalPicksPerMin: number | null; monitoringState: MachineMonitoringState } | null;
  now: Date;
  stopThresholdSec: number;
  /** M3 (Dilim 3): amir terime elle dokunduysa kaynak SUPERVISOR olur. */
  supervisorTouched?: boolean;
}

export interface ShiftBreakdownRow {
  reasonCode: string | null;
  reasonLabel: string | null;
  lossClass: MachineStopLossClass | null;
  beamSlotNull: boolean;
  stopCount: number;
  stopSec: number;
}

export interface ShiftTerms {
  calendarSec: number; unobservedSec: number; nonScheduledSec: number; plannedBreakSec: number;
  potSec: number; aptSec: number; setupSec: number; plannedDownSec: number; unplannedDownSec: number;
  minorStopSec: number; minorStopCount: number; stopCount: number;
  warpStopCount: number | null; weftStopCount: number | null; unclassifiedSec: number;
  picksActual: number; gapPicks: number; watchdogSec: number;
  targetPickCapacityApt: number; targetPickCapacityPot: number; targetPicksPerMin: number | null;
  stopThresholdSec: number; unitsPerCmAtClose: number | null; producedM: number | null;
  source: MachineDataSource; monitoringState: MachineMonitoringState;
  breakdown: ShiftBreakdownRow[];
  warnings: string[];
  /** Pencerede koşum ∧ duruş ∧ doff yok — rapor AYRI satırda beyan eder. */
  emptyLoom: boolean;
  runCount: number;
}

/** İki aralığın kesişimi (sn, ≥ 0, tam sayı). `[s0,s1) ∩ [w0,w1)`. */
export function overlapSec(s0: Date, s1: Date, w0: Date, w1: Date): number {
  const a = Math.max(s0.getTime(), w0.getTime());
  const b = Math.min(s1.getTime(), w1.getTime());
  return b > a ? Math.floor((b - a) / 1000) : 0;
}

/** Duruşun pencereye KIRPILMIŞ saniyesi — açık duruş `now`a kadar. TEK kırpma noktası. */
export function clipToWindow(startedAt: Date, endedAt: Date | null, w: ShiftWindow, now: Date): number {
  return overlapSec(startedAt, endedAt ?? now, w.startsAt, w.endsAt);
}

/** MINOR = SÜRE sınıfı: kapalı, eşik altı, ve kaybı kullanılabilirlikte olan (UNPLANNED/SETUP/sınıfsız). */
export function isMinorStop(s: Pick<ShiftStopInput, "endedAt" | "durationSec" | "lossClass">, thresholdSec: number): boolean {
  if (s.endedAt === null || s.durationSec === null) return false;
  if (s.lossClass === "PLANNED" || s.lossClass === "NON_SCHEDULED") return false;
  return s.durationSec < thresholdSec;
}

export function resolveShiftSource(a: { anySimulated: boolean; supervisorTouched: boolean; anyObservation: boolean }): MachineDataSource {
  if (a.anySimulated) return "SIMULATED";
  if (a.supervisorTouched) return "SUPERVISOR";
  return a.anyObservation ? "OPERATOR" : "INFERRED";
}

interface ClippedStop { s: ShiftStopInput; from: Date; to: Date; sec: number; minor: boolean; cls: MachineStopLossClass | null }

function clipStops(input: ShiftTermsInput): ClippedStop[] {
  const { window: w, now, stopThresholdSec } = input;
  const out: ClippedStop[] = [];
  for (const s of input.stops) {
    const sec = clipToWindow(s.startedAt, s.endedAt, w, now);
    if (sec <= 0) continue;
    const from = new Date(Math.max(s.startedAt.getTime(), w.startsAt.getTime()));
    const to = new Date(Math.min((s.endedAt ?? now).getTime(), w.endsAt.getTime()));
    const minor = isMinorStop(s, stopThresholdSec);
    out.push({ s, from, to, sec, minor, cls: minor ? "MINOR" : s.lossClass });
  }
  return out;
}

function emptyTerms(input: ShiftTermsInput, calendarSec: number, warnings: string[]): ShiftTerms {
  return {
    calendarSec, unobservedSec: 0, nonScheduledSec: 0, plannedBreakSec: 0, potSec: 0, aptSec: 0,
    setupSec: 0, plannedDownSec: 0, unplannedDownSec: 0, minorStopSec: 0, minorStopCount: 0, stopCount: 0,
    warpStopCount: null, weftStopCount: null, unclassifiedSec: 0, picksActual: 0, gapPicks: 0, watchdogSec: 0,
    targetPickCapacityApt: 0, targetPickCapacityPot: 0, targetPicksPerMin: null,
    stopThresholdSec: input.stopThresholdSec, unitsPerCmAtClose: null, producedM: null,
    source: "INFERRED", monitoringState: input.spec?.monitoringState ?? "OFF",
    breakdown: [], warnings, emptyLoom: true, runCount: 0,
  };
}

export function computeShiftTermsPure(input: ShiftTermsInput): ShiftTerms {
  const { window: w, now } = input;
  const calendarSec = Math.max(0, Math.floor((w.endsAt.getTime() - w.startsAt.getTime()) / 1000));
  if (w.isCancelled) return { ...emptyTerms(input, 0, ["Vardiya iptal edilmiş — terimler 0, oranlar ölçülemez."]), emptyLoom: false };

  const stops = clipStops(input);
  const runs = input.runs.filter((r) => overlapSec(r.startedAt, r.endedAt ?? now, w.startsAt, w.endsAt) > 0);
  const anyObservation = stops.length > 0 || runs.length > 0 || input.doffSources.length > 0;
  const warnings: string[] = [];

  if (!anyObservation) {
    const t = emptyTerms(input, calendarSec, ["Boş tezgah: pencerede koşum, duruş ve indirme yok — süre ÇALIŞMA DIŞI sayıldı (INFERRED); amir mühürden önce UNPLANNED'a çevirebilir."]);
    return { ...t, nonScheduledSec: calendarSec, plannedBreakSec: input.window.plannedBreakMinutes * 60 };
  }

  const acc = { nonScheduled: 0, planned: 0, setup: 0, unplanned: 0, minorSec: 0, minorCount: 0, unclassified: 0 };
  const rows = new Map<string, ShiftBreakdownRow>();
  for (const c of stops) {
    if (c.s.endedAt === null) warnings.push(`Açık duruş (${c.s.reasonCode ?? "sınıfsız"}) şu ana kadar sayıldı — kapanınca değişir.`);
    if (c.minor) { acc.minorSec += c.sec; acc.minorCount += 1; }
    else if (c.cls === "NON_SCHEDULED") acc.nonScheduled += c.sec;
    else if (c.cls === "PLANNED") acc.planned += c.sec;
    else if (c.cls === "SETUP") acc.setup += c.sec;
    else { acc.unplanned += c.sec; if (c.cls === null) acc.unclassified += c.sec; }
    const key = `${c.s.reasonCode ?? ""}|${c.cls ?? ""}|${c.s.beamSlot === null ? 1 : 0}`;
    const row = rows.get(key) ?? { reasonCode: c.s.reasonCode, reasonLabel: c.s.reasonLabel, lossClass: c.cls, beamSlotNull: c.s.beamSlot === null, stopCount: 0, stopSec: 0 };
    row.stopCount += 1; row.stopSec += c.sec; rows.set(key, row);
  }
  if (acc.unclassified > 0) warnings.push(`${acc.unclassified} sn sınıflandırılmamış duruş UNPLANNED sayıldı — sebep atanınca kova değişir.`);

  const plannedBreakSec = input.window.plannedBreakMinutes * 60;
  const potRaw = calendarSec - acc.nonScheduled - plannedBreakSec;
  if (potRaw < 0) warnings.push("Çalışma dışı süre + mola takvimi aşıyor (örtüşen duruş kayıtları?) — POT 0'a kırpıldı.");
  const potSec = Math.max(0, potRaw);
  const aptRaw = potSec - acc.setup - acc.planned - acc.unplanned;
  if (aptRaw < 0) warnings.push("Duruş toplamı planlı süreyi aşıyor (örtüşen duruş kayıtları?) — APT 0'a kırpıldı.");
  const aptSec = Math.max(0, aptRaw);

  const prod = { picks: 0, m: 0, mSeen: false, capApt: 0, capPot: 0, targets: [] as number[] };
  for (const r of runs) {
    const closedHere = r.endedAt !== null && r.endedAt.getTime() >= w.startsAt.getTime() && r.endedAt.getTime() < w.endsAt.getTime();
    if (closedHere) {
      if (r.picksAtClose === null) warnings.push("Kapanan koşumda atkı sayacı okunmadı — atkı 0 değil ÖLÇÜLMEDİ; performans eksik.");
      else prod.picks += r.picksAtClose;
      if (r.producedM !== null) { prod.m += r.producedM; prod.mSeen = true; }
    } else if (r.endedAt === null) warnings.push("Açık koşum: atkısı kapandığı vardiyaya yazılır, kapasitesi şu ana kadar sayıldı.");
    const target = r.targetPicksPerMin ?? input.spec?.nominalPicksPerMin ?? null;
    if (target === null) { warnings.push("Koşumun hedef deviri yok (koşum ve künye NULL) — kapasiteye girmedi, P ölçülemez."); continue; }
    prod.targets.push(target);
    const from = new Date(Math.max(r.startedAt.getTime(), w.startsAt.getTime()));
    const to = new Date(Math.min((r.endedAt ?? now).getTime(), w.endsAt.getTime()));
    const len = overlapSec(from, to, w.startsAt, w.endsAt);
    const inRun = (c: ClippedStop) => overlapSec(c.from, c.to, from, to);
    const runNonSched = stops.filter((c) => !c.minor && c.cls === "NON_SCHEDULED").reduce((a, c) => a + inRun(c), 0);
    const runDown = stops.filter((c) => !c.minor && c.cls !== "NON_SCHEDULED").reduce((a, c) => a + inRun(c), 0);
    const runBreak = calendarSec > 0 ? (plannedBreakSec * len) / calendarSec : 0;
    const runPot = Math.max(0, len - runNonSched - runBreak);
    const runApt = Math.max(0, runPot - runDown);
    prod.capPot += (target * runPot) / 60;
    prod.capApt += (target * runApt) / 60;
  }
  const single = runs.length === 1 ? runs[0]! : null;

  return {
    calendarSec, unobservedSec: 0, nonScheduledSec: acc.nonScheduled, plannedBreakSec, potSec, aptSec,
    setupSec: acc.setup, plannedDownSec: acc.planned, unplannedDownSec: acc.unplanned,
    minorStopSec: acc.minorSec, minorStopCount: acc.minorCount, stopCount: stops.length,
    warpStopCount: null, weftStopCount: null, unclassifiedSec: acc.unclassified,
    picksActual: prod.picks, gapPicks: 0, watchdogSec: 0,
    targetPickCapacityApt: Math.round(prod.capApt), targetPickCapacityPot: Math.round(prod.capPot),
    targetPicksPerMin: prod.targets.length === 1 && single ? prod.targets[0]! : null,
    stopThresholdSec: input.stopThresholdSec,
    unitsPerCmAtClose: single?.unitsPerCm ?? null,
    producedM: prod.mSeen ? Math.round(prod.m * 1000) / 1000 : null,
    source: resolveShiftSource({
      anySimulated: input.stops.some((s) => s.source === "SIMULATED") || input.doffSources.includes("SIMULATED"),
      supervisorTouched: input.supervisorTouched === true,
      anyObservation,
    }),
    monitoringState: input.spec?.monitoringState ?? "OFF",
    breakdown: [...rows.values()].sort((a, b) => b.stopSec - a.stopSec),
    warnings, emptyLoom: false, runCount: runs.length,
  };
}

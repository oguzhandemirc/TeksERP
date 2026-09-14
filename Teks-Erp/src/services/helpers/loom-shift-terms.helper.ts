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
//   • HAT KIRILIMI (`lines`): yalnız `productionLineCount > 1` iken; koşum ekseninden
//     (`productionLineNo`) ÜRETİM terimleri hat başına, süre terimleri makinede kalır.
//     Hat kümesi 1..count ∪ koşumların hatları ⇒ Σhat.unitsActual = unitsActual (bekçi ölçer).
//     Tek hatlıda `lines: []` — çıktının geri kalanı bayt bayt bugünkü.
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
  targetUnitsPerMin: number | null;
  unitsPerCm: number | null;
  /** `MachineRun.productionLineNo` — hat kırılımının ekseni (tek hatlıda hep 1). */
  productionLineNo: number;
}
export interface ShiftTermsInput {
  window: ShiftWindow & { isCancelled: boolean; plannedBreakMinutes: number };
  stops: ShiftStopInput[];
  runs: ShiftRunInput[];
  doffSources: MachineDataSource[];
  spec: { nominalUnitsPerMin: number | null; monitoringState: MachineMonitoringState } | null;
  /** `Machine.productionLineCount` — `> 1` ise `lines` doğar, değilse boş kalır. */
  productionLineCount: number;
  now: Date;
  stopThresholdSec: number;
  /** M3 (Dilim 3): amir terime elle dokunduysa kaynak SUPERVISOR olur. */
  supervisorTouched?: boolean;
}

/** Bir HATTIN üretim terimleri — `MachineShiftLineStat` kolonlarıyla birebir. */
export interface ShiftLineTerms {
  productionLineNo: number;
  runCount: number;
  unitsActual: number;
  targetUnitCapacityApt: number;
  targetUnitCapacityPot: number;
  targetUnitsPerMin: number | null;
  unitsPerCmAtClose: number | null;
  producedM: number | null;
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
  unitsActual: number; gapUnits: number; watchdogSec: number;
  targetUnitCapacityApt: number; targetUnitCapacityPot: number; targetUnitsPerMin: number | null;
  stopThresholdSec: number; unitsPerCmAtClose: number | null; producedM: number | null;
  source: MachineDataSource; monitoringState: MachineMonitoringState;
  breakdown: ShiftBreakdownRow[];
  warnings: string[];
  /** Pencerede koşum ∧ duruş ∧ doff yok — rapor AYRI satırda beyan eder. */
  emptyLoom: boolean;
  runCount: number;
  /** Hat kırılımı — yalnız `productionLineCount > 1`; tek hatlıda `[]`. */
  lines: ShiftLineTerms[];
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
    warpStopCount: null, weftStopCount: null, unclassifiedSec: 0, unitsActual: 0, gapUnits: 0, watchdogSec: 0,
    targetUnitCapacityApt: 0, targetUnitCapacityPot: 0, targetUnitsPerMin: null,
    stopThresholdSec: input.stopThresholdSec, unitsPerCmAtClose: null, producedM: null,
    source: "INFERRED", monitoringState: input.spec?.monitoringState ?? "OFF",
    breakdown: [], warnings, emptyLoom: true, runCount: 0, lines: lineTerms([], input.productionLineCount),
  };
}

/** Bir koşumun pencereye düşen üretim payı — makine toplamı ve hat kırılımı AYNI paydan toplanır. */
interface RunProduction {
  run: ShiftRunInput;
  /** Kapanışı bu pencerede ve sayaç okunmuşsa atkı; değilse null (0 DEĞİL). */
  picks: number | null;
  producedM: number | null;
  /** Hedef devir (koşum ?? künye); null = kapasiteye girmedi. */
  target: number | null;
  capApt: number;
  capPot: number;
}

interface RunContext { input: ShiftTermsInput; stops: ClippedStop[]; calendarSec: number; plannedBreakSec: number; warnings: string[] }

function runProduction(r: ShiftRunInput, ctx: RunContext): RunProduction {
  const { input, stops, calendarSec, plannedBreakSec, warnings } = ctx;
  const { window: w, now } = input;
  const closedHere = r.endedAt !== null && r.endedAt.getTime() >= w.startsAt.getTime() && r.endedAt.getTime() < w.endsAt.getTime();
  let picks: number | null = null;
  let producedM: number | null = null;
  if (closedHere) {
    if (r.picksAtClose === null) warnings.push("Kapanan koşumda atkı sayacı okunmadı — atkı 0 değil ÖLÇÜLMEDİ; performans eksik.");
    else picks = r.picksAtClose;
    producedM = r.producedM;
  } else if (r.endedAt === null) warnings.push("Açık koşum: atkısı kapandığı vardiyaya yazılır, kapasitesi şu ana kadar sayıldı.");
  const target = r.targetUnitsPerMin ?? input.spec?.nominalUnitsPerMin ?? null;
  if (target === null) {
    warnings.push("Koşumun hedef deviri yok (koşum ve künye NULL) — kapasiteye girmedi, P ölçülemez.");
    return { run: r, picks, producedM, target, capApt: 0, capPot: 0 };
  }
  const from = new Date(Math.max(r.startedAt.getTime(), w.startsAt.getTime()));
  const to = new Date(Math.min((r.endedAt ?? now).getTime(), w.endsAt.getTime()));
  const len = overlapSec(from, to, w.startsAt, w.endsAt);
  const inRun = (c: ClippedStop) => overlapSec(c.from, c.to, from, to);
  const runNonSched = stops.filter((c) => !c.minor && c.cls === "NON_SCHEDULED").reduce((a, c) => a + inRun(c), 0);
  const runDown = stops.filter((c) => !c.minor && c.cls !== "NON_SCHEDULED").reduce((a, c) => a + inRun(c), 0);
  const runBreak = calendarSec > 0 ? (plannedBreakSec * len) / calendarSec : 0;
  const runPot = Math.max(0, len - runNonSched - runBreak);
  const runApt = Math.max(0, runPot - runDown);
  return { run: r, picks, producedM, target, capApt: (target * runApt) / 60, capPot: (target * runPot) / 60 };
}

/** Koşum paylarının toplamı — makine düzeyi ve hat düzeyi aynı fonksiyondan (tek toplayıcı). */
function sumProduction(parts: RunProduction[]): Pick<ShiftLineTerms, "unitsActual" | "targetUnitCapacityApt" | "targetUnitCapacityPot" | "targetUnitsPerMin" | "unitsPerCmAtClose" | "producedM"> {
  const acc = { picks: 0, m: 0, mSeen: false, capApt: 0, capPot: 0, targets: [] as number[] };
  for (const p of parts) {
    if (p.picks !== null) acc.picks += p.picks;
    if (p.producedM !== null) { acc.m += p.producedM; acc.mSeen = true; }
    if (p.target !== null) acc.targets.push(p.target);
    acc.capApt += p.capApt;
    acc.capPot += p.capPot;
  }
  const single = parts.length === 1 ? parts[0]!.run : null;
  return {
    unitsActual: acc.picks,
    targetUnitCapacityApt: Math.round(acc.capApt), targetUnitCapacityPot: Math.round(acc.capPot),
    targetUnitsPerMin: acc.targets.length === 1 && single ? acc.targets[0]! : null,
    unitsPerCmAtClose: single?.unitsPerCm ?? null,
    producedM: acc.mSeen ? Math.round(acc.m * 1000) / 1000 : null,
  };
}

/** Hat kümesi 1..count ∪ koşumların hatları — hattı olmayan koşum kaybolmaz (Σhat = makine). */
function lineTerms(parts: RunProduction[], productionLineCount: number): ShiftLineTerms[] {
  if (productionLineCount <= 1) return [];
  const lineNos = new Set<number>();
  for (let i = 1; i <= productionLineCount; i++) lineNos.add(i);
  for (const p of parts) lineNos.add(p.run.productionLineNo);
  return [...lineNos].sort((a, b) => a - b).map((productionLineNo) => {
    const own = parts.filter((p) => p.run.productionLineNo === productionLineNo);
    return { productionLineNo, runCount: own.length, ...sumProduction(own) };
  });
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

  const parts = runs.map((r) => runProduction(r, { input, stops, calendarSec, plannedBreakSec, warnings }));

  return {
    calendarSec, unobservedSec: 0, nonScheduledSec: acc.nonScheduled, plannedBreakSec, potSec, aptSec,
    setupSec: acc.setup, plannedDownSec: acc.planned, unplannedDownSec: acc.unplanned,
    minorStopSec: acc.minorSec, minorStopCount: acc.minorCount, stopCount: stops.length,
    warpStopCount: null, weftStopCount: null, unclassifiedSec: acc.unclassified,
    ...sumProduction(parts), gapUnits: 0, watchdogSec: 0,
    stopThresholdSec: input.stopThresholdSec,
    source: resolveShiftSource({
      anySimulated: input.stops.some((s) => s.source === "SIMULATED") || input.doffSources.includes("SIMULATED"),
      supervisorTouched: input.supervisorTouched === true,
      anyObservation,
    }),
    monitoringState: input.spec?.monitoringState ?? "OFF",
    breakdown: [...rows.values()].sort((a, b) => b.stopSec - a.stopSec),
    warnings, emptyLoom: false, runCount: runs.length,
    lines: lineTerms(parts, input.productionLineCount),
  };
}

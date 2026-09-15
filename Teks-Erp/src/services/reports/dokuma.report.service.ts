// =============================================================================
// DOKUMA RAPORLARI — randıman · duruş Pareto · vardiya karnesi (rapor sözleşmesi ①②③)
// =============================================================================
// Üç rapor TEK toplayıcıdan okur (`collectShiftStatRows`: mühürlü satır DB'den, açık
// satır anlık) ve oranları TEK helper'dan alır (`loom-efficiency.helper`; burada bölme
// aritmetiği YOK — AST bekçisi ölçer). İKİ DEĞİŞMEZ:
//   ① ELLE GİRİŞ BİRİNCİ SINIF: her toplam satırı `source` kırılımını taşır; `SIMULATED`
//     `OPERATOR`a KATILMAZ (farklı güven sınıfı); tek yüzdeye çökertme YOK.
//   ② UFUK YAZILIR: `meta.ufuk = LOOM_HORIZON_DAY`, ufuktan önceki satır sayısı beyan edilir.
// ① RANDIMAN: A · P · E AYRI (çarpılmaz), "P: ölçülemedi" beyan (null + gerekçe).
// ② PARETO: SEBEP (reasonCode) × SÜRE SINIFI (lossClass) iki eksen; `MINOR` sebep DEĞİL
//   ayrı blok; sınıflandırılmamış ayrı kova; `atanmamis` (beamSlot NULL) AYRI eksen — sebep
//   listesiyle KESİŞİR (aynı duruş hem sebebinde hem atanmamış kovasında), toplanmaz.
// ③ VARDİYA KARNESİ: vardiya satırları; `source` kırılımı (ölçülen · elle · simüle · çıkarım) +
//   ölçülemeyen (P null) sayısı — toplam = Σkırılım (bekçi ölçer).
// =============================================================================
import type { MachineDataSource, MachineStopLossClass } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { LOOM_HORIZON_DAY, loomHorizonStart } from "../../constants/dokuma-ufku";
import { aggregateMachineKpis, type LoomKpiAggregate } from "../helpers/loom-efficiency.helper";
import { collectShiftStatRows, factoryDayKeyFromYmd, type ShiftLineRow, type ShiftStatRow, type ShiftStatRowExtra } from "../machine-shift-stat.service";
import { beamsMountedOnMachinesDuring, mountWindowsForBeams, resolveBeamLotFilter, shiftHasBeam, type BeamLotFilter, type BeamLotFilterInput, type BeamOption } from "../helpers/warp-beam-roll-filter.helper";

/**
 * Hat kırılımı opt-in (`?byLine=1`): satıra `hatlar` eklenir — mühürlüde çocuk tablo, açıkta anlık;
 * tek hatlı makinede `[]`. Opt-in yoksa alan HİÇ KONMAZ (eski istemci bayt bayt aynı gövde).
 */
export interface LineOptIn { byLine?: boolean }
const hatlar = (r: ShiftStatRowExtra): { hatlar?: ShiftLineRow[] } => (r.lines ? { hatlar: r.lines } : {});

export const DATA_SOURCES: readonly MachineDataSource[] = ["MACHINE", "OPERATOR", "SUPERVISOR", "SIMULATED", "INFERRED"];

export interface SourceBreakdown { satir: number; potSec: number }
export type SourceBreakdownTable = Record<MachineDataSource, SourceBreakdown>;

export interface LoomReportMeta {
  ufuk: string;
  ufukOncesiSatir: number;
  total: number;
  truncated: boolean;
  live: number;
  sealed: number;
  /** R5b-b2: pencerede satırların tezgahlarına bağlı geçen leventler — panel seçicisi kaynağı; süzgeçsiz yanıtta da döner, ≤200. */
  leventler: BeamOption[];
}

/** Satırların [min startsAt, max endsAt) penceresi + tezgah kümesi. */
function rowsWindow<R extends { machineId: string; shiftInstance: { startsAt: Date; endsAt: Date } }>(rows: R[]): { machineIds: string[]; from: Date; to: Date } {
  return {
    machineIds: [...new Set(rows.map((r) => r.machineId))],
    from: new Date(Math.min(...rows.map((r) => r.shiftInstance.startsAt.getTime()))),
    to: new Date(Math.max(...rows.map((r) => r.shiftInstance.endsAt.getTime()))),
  };
}

/** Seçici listesi süzgeç UYGULANMADAN önceki satırlardan türer (süzgeçliyken de tam liste — seçenek daralmasın). */
async function beamOptions(rows: Array<{ machineId: string; shiftInstance: { startsAt: Date; endsAt: Date } }>): Promise<BeamOption[]> {
  if (rows.length === 0) return [];
  const w = rowsWindow(rows);
  return beamsMountedOnMachinesDuring(prisma, w.machineIds, w.from, w.to);
}

/** Tezgah raporu satırlarını levent/lot süzgecinden geçirir: vardiya penceresinde o levent tezgahta bağlı mıydı (defterden). */
async function applyBeamFilter<R extends { machineId: string; shiftInstance: { startsAt: Date; endsAt: Date } }>(rows: R[], f: BeamLotFilter | null): Promise<{ rows: R[]; suzgec?: BeamSuzgec }> {
  if (!f) return { rows };
  const beyan = { ...(f.warpBeamId ? { warpBeamId: f.warpBeamId } : {}), ...(f.lotNo ? { lotNo: f.lotNo } : {}), levent: f.beamIds.length };
  if (rows.length === 0 || f.beamIds.length === 0) return { rows: [], suzgec: { ...beyan, dusenSatir: rows.length } };
  const w = rowsWindow(rows);
  const windows = await mountWindowsForBeams(prisma, f, w.machineIds, { from: w.from, to: w.to });
  const kept = rows.filter((r) => shiftHasBeam(windows, r.machineId, r.shiftInstance.startsAt, r.shiftInstance.endsAt));
  return { rows: kept, suzgec: { ...beyan, dusenSatir: rows.length - kept.length } };
}

function emptyBreakdown(): SourceBreakdownTable {
  return Object.fromEntries(DATA_SOURCES.map((k) => [k, { satir: 0, potSec: 0 }])) as SourceBreakdownTable;
}

function sumBreakdown(rows: Array<{ terms: { source: MachineDataSource; potSec: number } }>): SourceBreakdownTable {
  const k = emptyBreakdown();
  for (const r of rows) { k[r.terms.source].satir += 1; k[r.terms.source].potSec += r.terms.potSec; }
  return k;
}

function rowsBeforeHorizon(rows: Array<{ shiftInstance: { startsAt: Date } }>): number {
  const u = loomHorizonStart().getTime();
  return rows.filter((r) => r.shiftInstance.startsAt.getTime() < u).length;
}

function buildMeta(rows: Array<{ shiftInstance: { startsAt: Date } }>, m: { total: number; truncated: boolean; live: number; sealed: number }, leventler: BeamOption[]): LoomReportMeta {
  return { ufuk: LOOM_HORIZON_DAY, ufukOncesiSatir: rowsBeforeHorizon(rows), ...m, leventler };
}

/** Levent/lot süzgeci beyanı (R5b-b): verilen anahtarlar + kaç levent eşleşti, kaç satır düştü. Cevap KÖKÜNE gider (`suzgec` tek adres — 1e hükmü), süzgeç yoksa alan YOK. */
export type BeamSuzgec = { warpBeamId?: string; lotNo?: string; levent: number; dusenSatir: number };
/** Rota bunu cevap köküne kaldırır (`{ success, data, suzgec? }`). */
export interface WithSuzgec { suzgec?: BeamSuzgec }

// ─────────────────────────────────────────────────────────────────────────────
// ① RANDIMAN
// ─────────────────────────────────────────────────────────────────────────────
export interface EfficiencyRow {
  machineId: string; machine: { code: string; name: string };
  shiftInstanceId: string; factoryDayKey: Date; shift: { code: string; name: string };
  live: boolean; sealState: "OPEN" | "SEALED"; source: MachineDataSource; emptyLoom: boolean;
  potSec: number; aptSec: number; unitsActual: number; producedM: number | null;
  targetUnitCapacityApt: number; targetUnitCapacityPot: number; targetUnitsPerMin: number | null;
  availabilityPct: number | null; performancePct: number | null; effectivenessPct: number | null;
  olculemedi: { A?: string; P?: string; E?: string };
  warnings: string[];
  /** Yalnız `byLine` opt-in'inde; tek hatlı makinede `[]`. */
  hatlar?: ShiftLineRow[];
}
export interface EfficiencyReport extends WithSuzgec {
  satirlar: EfficiencyRow[];
  toplam: LoomKpiAggregate;
  kaynakKirilimi: SourceBreakdownTable;
  meta: LoomReportMeta;
}

export async function efficiencyReport(p: { from: string; to: string; machineId?: string } & LineOptIn & BeamLotFilterInput): Promise<EfficiencyReport> {
  const { byLine, warpBeamId, lotNo, ...params } = p;
  const filter = await resolveBeamLotFilter(prisma, { warpBeamId, lotNo });
  const collected = await collectShiftStatRows(params, { byLine });
  const { rows, suzgec } = await applyBeamFilter(collected.rows, filter);
  const leventler = await beamOptions(collected.rows);
  const m = collected.meta;
  const efficiencyRows: EfficiencyRow[] = rows.map((r) => ({
    machineId: r.machineId, machine: r.machine, shiftInstanceId: r.shiftInstanceId, factoryDayKey: r.shiftInstance.factoryDayKey,
    shift: r.shiftInstance.shiftDefinition, live: r.live, sealState: r.sealState, source: r.terms.source, emptyLoom: r.emptyLoom,
    potSec: r.terms.potSec, aptSec: r.terms.aptSec, unitsActual: r.terms.unitsActual, producedM: r.terms.producedM,
    targetUnitCapacityApt: r.terms.targetUnitCapacityApt, targetUnitCapacityPot: r.terms.targetUnitCapacityPot, targetUnitsPerMin: r.terms.targetUnitsPerMin,
    availabilityPct: r.kpis.availabilityPct, performancePct: r.kpis.performancePct, effectivenessPct: r.kpis.effectivenessPct,
    olculemedi: r.kpis.olculemedi, warnings: [...r.warnings, ...r.kpis.warnings],
    ...hatlar(r),
  }));
  return { satirlar: efficiencyRows, toplam: aggregateMachineKpis(rows.map((r) => r.terms)), kaynakKirilimi: sumBreakdown(rows), meta: buildMeta(rows, m, leventler), ...(suzgec ? { suzgec } : {}) };
}

// ─────────────────────────────────────────────────────────────────────────────
// ② DURUŞ PARETO
// ─────────────────────────────────────────────────────────────────────────────
export interface ParetoReasonRow { reasonCode: string; reasonLabel: string | null; lossClass: MachineStopLossClass | null; stopCount: number; stopSec: number }
export interface ParetoBucket { stopCount: number; stopSec: number }
export interface ParetoReport extends WithSuzgec {
  /** SEBEP × SÜRE SINIFI — süreye göre sıralı; MINOR ve sınıflandırılmamış BURADA DEĞİL. */
  sebepler: ParetoReasonRow[];
  /** MINOR: SÜRE sınıfı, sebep değil — ayrı blok. */
  mikroDuruslar: ParetoBucket;
  /** `reasonCode` NULL — karar yok (rapor UNPLANNED sayar, ama sebep listesine GİRMEZ). */
  siniflandirilmamis: ParetoBucket;
  /** Levent ekseni: `beamSlot` NULL — sebep listesiyle KESİŞİR, toplama EKLENMEZ. */
  atanmamis: ParetoBucket;
  /** = Σsebepler + mikro + sınıflandırılmamış (atanmamış hariç — o kesişen eksen). */
  toplam: ParetoBucket;
  kaynakKirilimi: SourceBreakdownTable;
  meta: LoomReportMeta;
}

export async function durusParetoReport(p: { from: string; to: string; machineId?: string } & BeamLotFilterInput): Promise<ParetoReport> {
  const { warpBeamId, lotNo, ...params } = p;
  const filter = await resolveBeamLotFilter(prisma, { warpBeamId, lotNo });
  const collected = await collectShiftStatRows(params, { includeBreakdown: true });
  const { rows, suzgec } = await applyBeamFilter(collected.rows, filter);
  const leventler = await beamOptions(collected.rows);
  const m = collected.meta;
  const reasons = new Map<string, ParetoReasonRow>();
  const minor: ParetoBucket = { stopCount: 0, stopSec: 0 };
  const unclassified: ParetoBucket = { stopCount: 0, stopSec: 0 };
  const unassigned: ParetoBucket = { stopCount: 0, stopSec: 0 };
  const total: ParetoBucket = { stopCount: 0, stopSec: 0 };
  for (const r of rows) for (const b of r.breakdown) {
    total.stopCount += b.stopCount; total.stopSec += b.stopSec;
    if (b.beamSlotNull) { unassigned.stopCount += b.stopCount; unassigned.stopSec += b.stopSec; }
    if (b.lossClass === "MINOR") { minor.stopCount += b.stopCount; minor.stopSec += b.stopSec; continue; }
    if (b.reasonCode === null) { unclassified.stopCount += b.stopCount; unclassified.stopSec += b.stopSec; continue; }
    const key = `${b.reasonCode}|${b.lossClass ?? ""}`;
    const row = reasons.get(key) ?? { reasonCode: b.reasonCode, reasonLabel: b.reasonLabel, lossClass: b.lossClass, stopCount: 0, stopSec: 0 };
    row.stopCount += b.stopCount; row.stopSec += b.stopSec; reasons.set(key, row);
  }
  return {
    sebepler: [...reasons.values()].sort((a, b) => b.stopSec - a.stopSec),
    mikroDuruslar: minor, siniflandirilmamis: unclassified, atanmamis: unassigned, toplam: total,
    kaynakKirilimi: sumBreakdown(rows), meta: buildMeta(rows, m, leventler), ...(suzgec ? { suzgec } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ③ VARDİYA KARNESİ
// ─────────────────────────────────────────────────────────────────────────────
export interface ShiftMachineRow {
  machineId: string; machine: { code: string; name: string }; source: MachineDataSource; live: boolean; sealState: "OPEN" | "SEALED";
  unitsActual: number; producedM: number | null; durusSec: number; emptyLoom: boolean;
  availabilityPct: number | null; performancePct: number | null; effectivenessPct: number | null; olculemedi: { A?: string; P?: string; E?: string };
  /** Yalnız `byLine` opt-in'inde; tek hatlı makinede `[]`. */
  hatlar?: ShiftLineRow[];
}
export interface ShiftRow {
  shiftInstanceId: string;
  /** R5b-b (5e bulgusu): panel vardiya seçicisi id üretebilsin — `shiftDefinitionId` süzgecinin karşılığı. */
  shiftDefinitionId: string;
  shift: { code: string; name: string }; startsAt: Date; endsAt: Date; isCancelled: boolean;
  uretim: { unitsActual: number; producedM: number | null };
  durusSec: number;
  /** Değişmez ①: satır sayısı = Σ kaynak kırılımı; `SIMULATED` `OPERATOR`a katılmaz. */
  kaynakKirilimi: SourceBreakdownTable;
  /** Sözleşme ③: "K'sı ÖLÇÜLDÜ, L'si ELLE, M'si ölçülemedi" — ölçülemedi = P null (hedef yok). */
  ozet: { olculen: number; elle: number; simule: number; cikarim: number; olculemedi: number; toplamSatir: number };
  makineler: ShiftMachineRow[];
}
export interface ShiftScorecardReport extends WithSuzgec { vardiyalar: ShiftRow[]; meta: LoomReportMeta }

const downSec = (t: ShiftStatRow["terms"]): number => t.setupSec + t.plannedDownSec + t.unplannedDownSec + t.minorStopSec;

export async function shiftScorecardReport(p: { factoryDay: string; shiftDefinitionId?: string } & LineOptIn & BeamLotFilterInput): Promise<ShiftScorecardReport> {
  if (p.shiftDefinitionId) {
    const def = await prisma.shiftDefinition.findUnique({ where: { id: p.shiftDefinitionId }, select: { id: true } });
    if (!def) throw AppError.notFound("Vardiya tanımı bulunamadı", { shiftDefinitionId: p.shiftDefinitionId });
  }
  const dayKey = factoryDayKeyFromYmd(p.factoryDay);
  const defIds = p.shiftDefinitionId
    ? new Set((await prisma.shiftInstance.findMany({ where: { factoryDayKey: dayKey, shiftDefinitionId: p.shiftDefinitionId }, select: { id: true } })).map((s) => s.id))
    : null;
  const filter = await resolveBeamLotFilter(prisma, { warpBeamId: p.warpBeamId, lotNo: p.lotNo });
  const collected = await collectShiftStatRows({ from: p.factoryDay, to: p.factoryDay }, { byLine: p.byLine });
  const { rows, suzgec } = await applyBeamFilter(collected.rows, filter);
  const m = collected.meta;
  const selected = defIds ? rows.filter((r) => defIds.has(r.shiftInstanceId)) : rows;
  // Seçici listesi vardiya tanımı süzgecine de bakar (o vardiyaların penceresi), levent süzgecine bakmaz.
  const leventler = await beamOptions(defIds ? collected.rows.filter((r) => defIds.has(r.shiftInstanceId)) : collected.rows);
  const byShift = new Map<string, Array<ShiftStatRow & ShiftStatRowExtra>>();
  for (const r of selected) byShift.set(r.shiftInstanceId, [...(byShift.get(r.shiftInstanceId) ?? []), r]);
  const shiftRows: ShiftRow[] = [...byShift.values()].map((group) => {
    const s = group[0]!.shiftInstance;
    const k = sumBreakdown(group);
    const mSeen = group.some((r) => r.terms.producedM !== null);
    return {
      shiftInstanceId: group[0]!.shiftInstanceId, shiftDefinitionId: s.shiftDefinitionId, shift: s.shiftDefinition, startsAt: s.startsAt, endsAt: s.endsAt, isCancelled: s.isCancelled,
      uretim: { unitsActual: group.reduce((a, r) => a + r.terms.unitsActual, 0), producedM: mSeen ? Math.round(group.reduce((a, r) => a + (r.terms.producedM ?? 0), 0) * 1000) / 1000 : null },
      durusSec: group.reduce((a, r) => a + downSec(r.terms), 0),
      kaynakKirilimi: k,
      ozet: {
        olculen: k.MACHINE.satir, elle: k.OPERATOR.satir + k.SUPERVISOR.satir, simule: k.SIMULATED.satir, cikarim: k.INFERRED.satir,
        olculemedi: group.filter((r) => r.kpis.performancePct === null).length, toplamSatir: group.length,
      },
      makineler: group.map((r) => ({
        machineId: r.machineId, machine: r.machine, source: r.terms.source, live: r.live, sealState: r.sealState,
        unitsActual: r.terms.unitsActual, producedM: r.terms.producedM, durusSec: downSec(r.terms), emptyLoom: r.emptyLoom,
        availabilityPct: r.kpis.availabilityPct, performancePct: r.kpis.performancePct, effectivenessPct: r.kpis.effectivenessPct, olculemedi: r.kpis.olculemedi,
        ...hatlar(r),
      })),
    };
  });
  return { vardiyalar: shiftRows, meta: buildMeta(selected, { ...m, total: selected.length }, leventler), ...(suzgec ? { suzgec } : {}) };
}

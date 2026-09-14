// =============================================================================
// TeksERP — VARDİYA KARNESİ (MachineShiftStat) okuma: canlı karne (M1)
// =============================================================================
// M1 (DOKUMA-RAPOR-BACKEND-TASARIM-OZETI §4): pencere açıkken (satır yok ya da OPEN)
// karne ANLIK hesaplanır, YAZILMAZ; MÜHÜRLÜ satır olduğu gibi döner (resmî rakam).
// Terimler `loom-shift-terms.helper` (tek helper), oranlar `loom-efficiency.helper`.
// Tezgah kümesi: aktif makine ∧ istasyonu `WEAVING` — "tezgah = WEAVING istasyonundaki
// makine" (StationKind.WEAVING hükmü); künye/izleme hâli süzmez, KOPYALANIR: elle giriş
// birinci sınıftır, izlenmeyen (OFF) tezgahın karnesi de vardır (rapor değişmezi ①).
// Yazma YOK — M2–M5 Dilim 3.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { MINOR_STOP_THRESHOLD_SEC } from "../constants/loom-shift";
import { computeShiftTermsPure, type ShiftBreakdownRow, type ShiftLineTerms, type ShiftTerms, type ShiftTermsInput } from "./helpers/loom-shift-terms.helper";
import { computeMachineKpis, type LoomKpis } from "./helpers/loom-efficiency.helper";

type Tx = Prisma.TransactionClient | typeof prisma;

/** Liste tavanı — vardiya×makine; 30 gün × 3 vardiya × 5 tezgah = 450. Sayı kırpılmaz. */
export const SHIFT_STAT_LIST_TAKE = 500;

const dec = (d: Prisma.Decimal | null): number | null => (d === null ? null : Number(d));

/** `YYYY-MM-DD` → `factoryDayKey`/`factoryDay`nin sakladığı UTC gece yarısı. */
export function factoryDayKeyFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Terim girdisini DB'den toplar — pencereyle KESİŞEN kayıtlar (kırpma helper'da). */
export async function loadShiftTermsInput(tx: Tx, machineId: string, shiftInstanceId: string, now = new Date()): Promise<ShiftTermsInput> {
  const shift = await tx.shiftInstance.findUnique({
    where: { id: shiftInstanceId },
    select: { startsAt: true, endsAt: true, isCancelled: true, shiftDefinition: { select: { plannedBreakMinutes: true } } },
  });
  if (!shift) throw AppError.notFound("Vardiya bulunamadı", { shiftInstanceId });
  const w = { startsAt: shift.startsAt, endsAt: shift.endsAt };
  const intersects = { startedAt: { lt: w.endsAt }, OR: [{ endedAt: null }, { endedAt: { gt: w.startsAt } }] };
  const [stops, runs, doffs, spec, machine] = [
    await tx.machineStopEvent.findMany({
      where: { machineId, revokedAt: null, ...intersects },
      select: { id: true, startedAt: true, endedAt: true, durationSec: true, reasonCode: true, lossClass: true, beamSlot: true, source: true },
      orderBy: { startedAt: "asc" },
    }),
    await tx.machineRun.findMany({
      where: { machineId, revokedAt: null, ...intersects },
      select: { id: true, startedAt: true, endedAt: true, picksAtClose: true, producedM: true, targetUnitsPerMin: true, unitsPerCm: true, productionLineNo: true },
      orderBy: { startedAt: "asc" },
    }),
    await tx.doffEvent.findMany({
      where: { machineId, revokedAt: null, doffedAt: { gte: w.startsAt, lt: w.endsAt } },
      select: { counterSource: true },
    }),
    await tx.machineSpec.findUnique({ where: { machineId }, select: { nominalUnitsPerMin: true, monitoringState: true } }),
    // Hat kırılımının tetiği VERİDİR: `productionLineCount > 1` değilse `lines` boş doğar (bayrak yok).
    await tx.machine.findUniqueOrThrow({ where: { id: machineId }, select: { productionLineCount: true } }),
  ];
  // Sebep etiketi katalogdan KOPYALANIR (breakdown `reasonLabel` DONAR — katalog değişse rapor değişmez).
  const codes = [...new Set(stops.map((s) => s.reasonCode).filter((c): c is string => c !== null))];
  const presets = codes.length
    ? await tx.reasonPreset.findMany({ where: { kind: "MACHINE_STOP", code: { in: codes } }, select: { code: true, label: true } })
    : [];
  const labelOf = new Map(presets.map((p) => [p.code, p.label]));
  return {
    window: { ...w, isCancelled: shift.isCancelled, plannedBreakMinutes: shift.shiftDefinition.plannedBreakMinutes },
    stops: stops.map((s) => ({ ...s, reasonLabel: s.reasonCode ? (labelOf.get(s.reasonCode) ?? null) : null })),
    runs: runs.map((r) => ({ ...r, producedM: dec(r.producedM), unitsPerCm: dec(r.unitsPerCm) })),
    doffSources: doffs.map((d) => d.counterSource),
    spec,
    productionLineCount: machine.productionLineCount,
    now,
    stopThresholdSec: MINOR_STOP_THRESHOLD_SEC,
  };
}

/** Bir (makine × vardiya) için ANLIK terimler — okuyucu ve (Dilim 3) materyalizasyon aynı kapıdan geçer. */
export async function computeShiftTerms(tx: Tx, machineId: string, shiftInstanceId: string, opts: { now?: Date; supervisorTouched?: boolean } = {}): Promise<ShiftTerms> {
  const input = await loadShiftTermsInput(tx, machineId, shiftInstanceId, opts.now);
  return computeShiftTermsPure({ ...input, supervisorTouched: opts.supervisorTouched });
}

export interface ShiftStatRow {
  machineId: string;
  machine: { code: string; name: string };
  shiftInstanceId: string;
  shiftInstance: { factoryDayKey: Date; startsAt: Date; endsAt: Date; isCancelled: boolean; shiftDefinition: { code: string; name: string } };
  /** `true` = anlık hesap (satır yok ya da OPEN); `false` = mühürlü satır olduğu gibi. */
  live: boolean;
  sealState: "OPEN" | "SEALED";
  sealGeneration: number;
  sealedAt: Date | null;
  terms: Omit<ShiftTerms, "breakdown" | "warnings" | "emptyLoom" | "runCount" | "lines">;
  kpis: LoomKpis;
  emptyLoom: boolean;
  warnings: string[];
}

export interface ShiftStatListParams {
  /** Fabrika günü `YYYY-MM-DD`, dahil. */
  from: string;
  to: string;
  machineId?: string;
  sealState?: "OPEN" | "SEALED";
}

const SHIFT_SELECT = {
  id: true, factoryDayKey: true, startsAt: true, endsAt: true, isCancelled: true,
  shiftDefinition: { select: { code: true, name: true } },
} satisfies Prisma.ShiftInstanceSelect;

/** Tezgah kümesi: aktif ∧ WEAVING istasyonu (+ süzgeç). Künye süzmez. */
async function listLooms(machineId?: string): Promise<Array<{ id: string; code: string; name: string }>> {
  return prisma.machine.findMany({
    where: { isActive: true, station: { kind: "WEAVING" }, ...(machineId ? { id: machineId } : {}) },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
}

const STAT_SELECT = {
  id: true, machineId: true, shiftInstanceId: true, sealState: true, sealGeneration: true, sealedAt: true,
  calendarSec: true, unobservedSec: true, nonScheduledSec: true, plannedBreakSec: true, potSec: true, aptSec: true,
  setupSec: true, plannedDownSec: true, unplannedDownSec: true, minorStopSec: true, minorStopCount: true, stopCount: true,
  warpStopCount: true, weftStopCount: true, unclassifiedSec: true, unitsActual: true, gapUnits: true, watchdogSec: true,
  targetUnitCapacityApt: true, targetUnitCapacityPot: true, targetUnitsPerMin: true, stopThresholdSec: true,
  unitsPerCmAtClose: true, producedM: true, source: true, monitoringState: true,
} satisfies Prisma.MachineShiftStatSelect;

function storedTerms(s: Prisma.MachineShiftStatGetPayload<{ select: typeof STAT_SELECT }>): ShiftStatRow["terms"] {
  const { id: _id, machineId: _m, shiftInstanceId: _s, sealState: _st, sealGeneration: _g, sealedAt: _a, ...rest } = s;
  return { ...rest, unitsPerCmAtClose: dec(rest.unitsPerCmAtClose), producedM: dec(rest.producedM) };
}


/** Bir hattın satırı — P/E hattın, A ebeveynin (süre terimleri makine düzeyi, `LoomKpiTerms` pot/apt ebeveynden). */
export interface ShiftLineRow extends ShiftLineTerms {
  kpis: LoomKpis;
}

/**
 * Rapor okuyucuları için ek alanlar (`includeBreakdown`): kırılım mühürlüde SON kuşak, açıkta canlı.
 * `lines` yalnız `byLine` opt-in'inde DOLDURULUR (mühürlüde çocuk tablo, açıkta anlık); opt-in yoksa
 * alan hiç konmaz — eski istemci bayt bayt aynı gövdeyi görür. Tek hatlı makinede `[]`.
 */
export interface ShiftStatRowExtra {
  statId: string | null;
  breakdown: ShiftBreakdownRow[];
  lines?: ShiftLineRow[];
}

export interface ShiftStatCollectOptions {
  now?: Date;
  includeBreakdown?: boolean;
  /** Hat kırılımı opt-in (`?byLine=1`). */
  byLine?: boolean;
}

const LINE_SELECT = {
  productionLineNo: true, runCount: true, unitsActual: true, targetUnitCapacityApt: true, targetUnitCapacityPot: true,
  targetUnitsPerMin: true, unitsPerCmAtClose: true, producedM: true,
} satisfies Prisma.MachineShiftLineStatSelect;

/** Hat satırlarına oran: pay hattın, süre paydası ebeveynin (A aynı çıkar — makine duruşu hattı da durdurur). */
function lineRows(lines: ShiftLineTerms[], parent: Pick<ShiftTerms, "potSec" | "aptSec">): ShiftLineRow[] {
  return lines.map((l) => ({
    ...l,
    kpis: computeMachineKpis({ potSec: parent.potSec, aptSec: parent.aptSec, unitsActual: l.unitsActual, gapUnits: 0, targetUnitCapacityApt: l.targetUnitCapacityApt, targetUnitCapacityPot: l.targetUnitCapacityPot }),
  }));
}

/** Mühürlü karnenin hat satırları çocuk tablodan (DURUM; mühürle birlikte donmuş). */
async function storedLineRows(statId: string, parent: Pick<ShiftTerms, "potSec" | "aptSec">): Promise<ShiftLineRow[]> {
  const rows = await prisma.machineShiftLineStat.findMany({ where: { statId }, select: LINE_SELECT, orderBy: { productionLineNo: "asc" } });
  return lineRows(rows.map((r) => ({ ...r, unitsPerCmAtClose: dec(r.unitsPerCmAtClose), producedM: dec(r.producedM) })), parent);
}

/** M3 ebeveyne yazar, hatlara dokunmaz: Σhat ≠ karne olunca UYARI (sessiz sapma yok). */
function lineSumWarning(lines: ShiftLineRow[], parent: Pick<ShiftTerms, "unitsActual" | "source">): string[] {
  if (lines.length === 0) return [];
  const sum = lines.reduce((a, l) => a + l.unitsActual, 0);
  return sum === parent.unitsActual ? [] : [`Hat kırılımı koşumdan hesaplanır; karne ${parent.source === "SUPERVISOR" ? "elle düzeltildi" : "farklı"} — Σhat atkı ${sum} ≠ karne ${parent.unitsActual}.`];
}

/**
 * Karne satırlarını toplar — vardiya × tezgah. Süzme SUNUCUDA, liste tavanda kırpılır sayı kırpılmaz.
 * Mühürlü satır DB'den (`live:false`), diğerleri anlık. Rapor uçları da BURADAN okur (tek toplayıcı).
 */
export async function collectShiftStatRows(p: ShiftStatListParams, opts: ShiftStatCollectOptions = {}): Promise<{ rows: Array<ShiftStatRow & ShiftStatRowExtra>; meta: { total: number; truncated: boolean; live: number; sealed: number } }> {
  const now = opts.now ?? new Date();
  const fromKey = factoryDayKeyFromYmd(p.from);
  const toKey = factoryDayKeyFromYmd(p.to);
  if (toKey < fromKey) throw AppError.badRequest("Bitiş günü başlangıçtan önce olamaz");
  const shifts = await prisma.shiftInstance.findMany({
    where: { factoryDayKey: { gte: fromKey, lte: toKey } },
    select: SHIFT_SELECT,
    orderBy: [{ startsAt: "asc" }],
  });
  const looms = await listLooms(p.machineId);
  const stored = await prisma.machineShiftStat.findMany({
    where: { shiftInstanceId: { in: shifts.map((s) => s.id) }, ...(p.machineId ? { machineId: p.machineId } : {}) },
    select: STAT_SELECT,
  });
  const storedBy = new Map(stored.map((s) => [`${s.machineId}|${s.shiftInstanceId}`, s]));

  const pairs: Array<{ shift: (typeof shifts)[number]; loom: (typeof looms)[number] }> = [];
  for (const shift of shifts) for (const loom of looms) pairs.push({ shift, loom });
  const total = pairs.length;
  const rows: Array<ShiftStatRow & ShiftStatRowExtra> = [];
  let live = 0;
  let sealed = 0;
  for (const { shift, loom } of pairs.slice(0, SHIFT_STAT_LIST_TAKE)) {
    const s = storedBy.get(`${loom.id}|${shift.id}`);
    const base = { machineId: loom.id, machine: { code: loom.code, name: loom.name }, shiftInstanceId: shift.id, shiftInstance: shift, statId: s?.id ?? null };
    if (s && s.sealState === "SEALED") {
      if (p.sealState === "OPEN") continue;
      sealed += 1;
      const terms = storedTerms(s);
      // Mühürlü kırılım = SON KUŞAK (defter; katalog değişse etiket değişmez).
      const breakdown = opts.includeBreakdown
        ? await prisma.machineShiftStopBreakdown.findMany({ where: { statId: s.id, sealGeneration: s.sealGeneration }, select: { reasonCode: true, reasonLabel: true, lossClass: true, beamSlotNull: true, stopCount: true, stopSec: true } })
        : [];
      const lines = opts.byLine ? await storedLineRows(s.id, terms) : undefined;
      rows.push({ ...base, live: false, sealState: "SEALED", sealGeneration: s.sealGeneration, sealedAt: s.sealedAt, terms, kpis: computeMachineKpis(terms), emptyLoom: false, warnings: lines ? lineSumWarning(lines, terms) : [], breakdown, ...(lines ? { lines } : {}) });
      continue;
    }
    if (p.sealState === "SEALED") continue;
    live += 1;
    const { breakdown, warnings, emptyLoom, runCount: _r, lines: liveLines, ...terms } = await computeShiftTerms(prisma, loom.id, shift.id, { now });
    const lines = opts.byLine ? lineRows(liveLines, terms) : undefined;
    rows.push({ ...base, live: true, sealState: "OPEN", sealGeneration: s?.sealGeneration ?? 0, sealedAt: s?.sealedAt ?? null, terms, kpis: computeMachineKpis(terms), emptyLoom, warnings, breakdown: opts.includeBreakdown ? breakdown : [], ...(lines ? { lines } : {}) });
  }
  return { rows, meta: { total, truncated: total > SHIFT_STAT_LIST_TAKE, live, sealed } };
}

/** M1 — karne listesi ucu (kırılımsız; `statId` DÖNER — panel mühür eylemleri onunla, `null` = satır henüz yazılmadı; `byLine` hat satırlarını ekler). */
export async function listShiftStats(p: ShiftStatListParams & { byLine?: boolean }, now = new Date()): Promise<ApiResponse<Array<ShiftStatRow & Pick<ShiftStatRowExtra, "statId" | "lines">>> & { meta: { total: number; truncated: boolean; live: number; sealed: number } }> {
  const { byLine, ...params } = p;
  const { rows, meta } = await collectShiftStatRows(params, { now, byLine });
  return { success: true, data: rows.map(({ breakdown: _b, ...row }) => row), meta };
}

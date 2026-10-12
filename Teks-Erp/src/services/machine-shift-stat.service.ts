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
import { LOOM_MACHINE_WHERE, MINOR_STOP_THRESHOLD_SEC } from "../constants/loom-shift";
import { computeShiftTermsPure, type ShiftBreakdownRow, type ShiftLineTerms, type ShiftTerms, type ShiftTermsInput } from "./helpers/loom-shift-terms.helper";
import { computeMachineKpis, type LoomKpis } from "./helpers/loom-efficiency.helper";

type Tx = Prisma.TransactionClient | typeof prisma;

const dec = (d: Prisma.Decimal | null): number | null => (d === null ? null : Number(d));

/** `YYYY-MM-DD` → `factoryDayKey`/`factoryDay`nin sakladığı UTC gece yarısı. */
export function factoryDayKeyFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Toplu terim yükleyicisine verilen vardiya penceresi. */
export interface ShiftWindowForTerms { id: string; startsAt: Date; endsAt: Date; isCancelled: boolean; plannedBreakMinutes: number }

/** Bir yükleme turunda en çok bu kadar vardiya (≈ 7 gün × 3) — bellek sınırı; tur başına sabit 6–7 SQL. */
export const SHIFT_TERMS_BATCH_SHIFTS = 21;

const pairKey = (machineId: string, shiftInstanceId: string): string => `${machineId}|${shiftInstanceId}`;
const overlaps = (r: { startedAt: Date; endedAt: Date | null }, w: { startsAt: Date; endsAt: Date }): boolean =>
  r.startedAt < w.endsAt && (r.endedAt === null || r.endedAt > w.startsAt);

/**
 * Terim girdilerini TOPLU yükler — (makine × vardiya) çiftleri için TEK tur: duruş · koşum · doff · künye ·
 * makine · sebep etiketi birer SQL, pencereyle kesişen kayıtlar bellekte çiftlere bölünür (kırpma helper'da).
 * Tekil yol da buradan geçer (tek yükleyici): toplu ile tekil aynı girdiyi üretir.
 */
export async function loadShiftTermsInputs(tx: Tx, machineIds: string[], shifts: ShiftWindowForTerms[], now = new Date()): Promise<Map<string, ShiftTermsInput>> {
  const out = new Map<string, ShiftTermsInput>();
  if (machineIds.length === 0 || shifts.length === 0) return out;
  const gFrom = new Date(Math.min(...shifts.map((s) => s.startsAt.getTime())));
  const gTo = new Date(Math.max(...shifts.map((s) => s.endsAt.getTime())));
  const intersects = { startedAt: { lt: gTo }, OR: [{ endedAt: null }, { endedAt: { gt: gFrom } }] };
  const machineIn = { in: machineIds };
  const stops = await tx.machineStopEvent.findMany({
    where: { machineId: machineIn, revokedAt: null, ...intersects },
    select: { id: true, machineId: true, startedAt: true, endedAt: true, durationSec: true, reasonCode: true, lossClass: true, beamSlot: true, source: true },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
  });
  const runs = await tx.machineRun.findMany({
    where: { machineId: machineIn, revokedAt: null, ...intersects },
    select: { id: true, machineId: true, startedAt: true, endedAt: true, picksAtClose: true, producedM: true, targetUnitsPerMin: true, unitsPerCm: true, productionLineNo: true },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
  });
  const doffs = await tx.doffEvent.findMany({
    where: { machineId: machineIn, revokedAt: null, doffedAt: { gte: gFrom, lt: gTo } },
    select: { machineId: true, doffedAt: true, counterSource: true },
    orderBy: [{ doffedAt: "asc" }, { id: "asc" }],
  });
  const specs = await tx.machineSpec.findMany({ where: { machineId: machineIn }, select: { machineId: true, nominalUnitsPerMin: true, monitoringState: true } });
  // Hat kırılımının tetiği VERİDİR: `productionLineCount > 1` değilse `lines` boş doğar (bayrak yok).
  const machines = await tx.machine.findMany({ where: { id: machineIn }, select: { id: true, productionLineCount: true } });
  // Sebep etiketi katalogdan KOPYALANIR (breakdown `reasonLabel` DONAR — katalog değişse rapor değişmez).
  const codes = [...new Set(stops.map((s) => s.reasonCode).filter((c): c is string => c !== null))];
  const presets = codes.length
    ? await tx.reasonPreset.findMany({ where: { kind: "MACHINE_STOP", code: { in: codes } }, select: { code: true, label: true } })
    : [];
  const labelOf = new Map(presets.map((p) => [p.code, p.label]));
  const group = <T extends { machineId: string }>(rows: T[]): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const r of rows) { const a = m.get(r.machineId); if (a) a.push(r); else m.set(r.machineId, [r]); }
    return m;
  };
  const stopsBy = group(stops);
  const runsBy = group(runs);
  const doffsBy = group(doffs);
  const specBy = new Map(specs.map(({ machineId, ...s }) => [machineId, s]));
  const lineCountBy = new Map(machines.map((m) => [m.id, m.productionLineCount]));
  for (const machineId of machineIds) {
    const lineCount = lineCountBy.get(machineId);
    if (lineCount === undefined) continue;
    for (const sh of shifts) {
      const w = { startsAt: sh.startsAt, endsAt: sh.endsAt };
      out.set(pairKey(machineId, sh.id), {
        window: { ...w, isCancelled: sh.isCancelled, plannedBreakMinutes: sh.plannedBreakMinutes },
        stops: (stopsBy.get(machineId) ?? []).filter((s) => overlaps(s, w)).map(({ machineId: _m, ...s }) => ({ ...s, reasonLabel: s.reasonCode ? (labelOf.get(s.reasonCode) ?? null) : null })),
        runs: (runsBy.get(machineId) ?? []).filter((r) => overlaps(r, w)).map(({ machineId: _m, ...r }) => ({ ...r, producedM: dec(r.producedM), unitsPerCm: dec(r.unitsPerCm) })),
        doffSources: (doffsBy.get(machineId) ?? []).filter((d) => d.doffedAt >= w.startsAt && d.doffedAt < w.endsAt).map((d) => d.counterSource),
        spec: specBy.get(machineId) ?? null,
        productionLineCount: lineCount,
        now,
        stopThresholdSec: MINOR_STOP_THRESHOLD_SEC,
      });
    }
  }
  return out;
}

/** Terim girdisini DB'den toplar — tek çift; toplu yükleyicinin bir elemanı (tek yükleyici). */
export async function loadShiftTermsInput(tx: Tx, machineId: string, shiftInstanceId: string, now = new Date()): Promise<ShiftTermsInput> {
  const shift = await tx.shiftInstance.findUnique({
    where: { id: shiftInstanceId },
    select: { startsAt: true, endsAt: true, isCancelled: true, shiftDefinition: { select: { plannedBreakMinutes: true } } },
  });
  if (!shift) throw AppError.notFound("Vardiya bulunamadı", { shiftInstanceId });
  const inputs = await loadShiftTermsInputs(tx, [machineId], [{ id: shiftInstanceId, startsAt: shift.startsAt, endsAt: shift.endsAt, isCancelled: shift.isCancelled, plannedBreakMinutes: shift.shiftDefinition.plannedBreakMinutes }], now);
  const input = inputs.get(pairKey(machineId, shiftInstanceId));
  if (!input) throw AppError.notFound("Makine bulunamadı", { machineId });
  return input;
}

/** Bir (makine × vardiya) için ANLIK terimler — okuyucu ve (Dilim 3) materyalizasyon aynı kapıdan geçer. */
export async function computeShiftTerms(tx: Tx, machineId: string, shiftInstanceId: string, opts: { now?: Date; supervisorTouched?: boolean } = {}): Promise<ShiftTerms> {
  const input = await loadShiftTermsInput(tx, machineId, shiftInstanceId, opts.now);
  return computeShiftTermsPure({ ...input, supervisorTouched: opts.supervisorTouched });
}

/** Çok çiftin ANLIK terimleri — vardiyalar `SHIFT_TERMS_BATCH_SHIFTS`lik turlarla; anahtar `makine|vardiya`. */
export async function computeShiftTermsMany(tx: Tx, pairs: Array<{ machineId: string; shift: ShiftWindowForTerms }>, now = new Date()): Promise<Map<string, ShiftTerms>> {
  const out = new Map<string, ShiftTerms>();
  const machinesByShift = new Map<string, { shift: ShiftWindowForTerms; machineIds: Set<string> }>();
  for (const p of pairs) {
    const e = machinesByShift.get(p.shift.id) ?? { shift: p.shift, machineIds: new Set<string>() };
    e.machineIds.add(p.machineId);
    machinesByShift.set(p.shift.id, e);
  }
  const entries = [...machinesByShift.values()].sort((a, b) => a.shift.startsAt.getTime() - b.shift.startsAt.getTime());
  for (let i = 0; i < entries.length; i += SHIFT_TERMS_BATCH_SHIFTS) {
    const chunk = entries.slice(i, i + SHIFT_TERMS_BATCH_SHIFTS);
    const machineIds = [...new Set(chunk.flatMap((e) => [...e.machineIds]))];
    const inputs = await loadShiftTermsInputs(tx, machineIds, chunk.map((e) => e.shift), now);
    for (const e of chunk) for (const machineId of e.machineIds) {
      const input = inputs.get(pairKey(machineId, e.shift.id));
      if (input) out.set(pairKey(machineId, e.shift.id), computeShiftTermsPure(input));
    }
  }
  return out;
}

export interface ShiftStatRow {
  machineId: string;
  machine: { code: string; name: string };
  shiftInstanceId: string;
  shiftInstance: { factoryDayKey: Date; startsAt: Date; endsAt: Date; isCancelled: boolean; shiftDefinitionId: string; shiftDefinition: { code: string; name: string } };
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
  id: true, factoryDayKey: true, startsAt: true, endsAt: true, isCancelled: true, shiftDefinitionId: true,
  shiftDefinition: { select: { code: true, name: true } },
} satisfies Prisma.ShiftInstanceSelect;

/** Tezgah kümesi: aktif ∧ WEAVING istasyonu (+ süzgeç). Künye süzmez. */
async function listLooms(machineId?: string): Promise<Array<{ id: string; code: string; name: string }>> {
  return prisma.machine.findMany({
    where: { ...LOOM_MACHINE_WHERE, ...(machineId ? { id: machineId } : {}) },
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

/** Mühürlü karnenin hat satırları çocuk tablodan (DURUM; mühürle birlikte donmuş) — toplu okunmuş satırlardan. */
function storedLineRows(rows: Array<Prisma.MachineShiftLineStatGetPayload<{ select: typeof LINE_SELECT }>>, parent: Pick<ShiftTerms, "potSec" | "aptSec">): ShiftLineRow[] {
  return lineRows(rows.map((r) => ({ ...r, unitsPerCmAtClose: dec(r.unitsPerCmAtClose), producedM: dec(r.producedM) })), parent);
}

/** M3 ebeveyne yazar, hatlara dokunmaz: Σhat ≠ karne olunca UYARI (sessiz sapma yok). */
function lineSumWarning(lines: ShiftLineRow[], parent: Pick<ShiftTerms, "unitsActual" | "source">): string[] {
  if (lines.length === 0) return [];
  const sum = lines.reduce((a, l) => a + l.unitsActual, 0);
  return sum === parent.unitsActual ? [] : [`Hat kırılımı koşumdan hesaplanır; karne ${parent.source === "SUPERVISOR" ? "elle düzeltildi" : "farklı"} — Σhat atkı ${sum} ≠ karne ${parent.unitsActual}.`];
}

/** IN listesi parça boyu — bağ parametresi tavanının çok altında. */
const IN_CHUNK = 5000;
function chunks<T>(xs: T[], n = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export interface ShiftStatCollectMeta { total: number; truncated: boolean; live: number; sealed: number }

/**
 * Karne satırlarını toplar — vardiya × tezgah, seçilen aralığın TAMAMI (kesme yok; toplam/Pareto bu kümeden).
 * Süzme SUNUCUDA; mühürlü satır DB'den (`live:false`), diğerleri anlık ve TOPLU (tur başına sabit SQL).
 * Rapor uçları da BURADAN okur (tek toplayıcı); listeyi sayfalayan `pageShiftRows`tır, toplayıcı değil.
 */
export async function collectShiftStatRows(p: ShiftStatListParams, opts: ShiftStatCollectOptions = {}): Promise<{ rows: Array<ShiftStatRow & ShiftStatRowExtra>; meta: ShiftStatCollectMeta }> {
  const now = opts.now ?? new Date();
  const fromKey = factoryDayKeyFromYmd(p.from);
  const toKey = factoryDayKeyFromYmd(p.to);
  if (toKey < fromKey) throw AppError.badRequest("Bitiş günü başlangıçtan önce olamaz");
  const shiftRows = await prisma.shiftInstance.findMany({
    where: { factoryDayKey: { gte: fromKey, lte: toKey } },
    select: { ...SHIFT_SELECT, shiftDefinition: { select: { code: true, name: true, plannedBreakMinutes: true } } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
  const shifts = shiftRows.map(({ shiftDefinition: { plannedBreakMinutes, ...def }, ...s }) => ({ shift: { ...s, shiftDefinition: def }, plannedBreakMinutes }));
  const looms = await listLooms(p.machineId);
  const stored = await prisma.machineShiftStat.findMany({
    where: { shiftInstanceId: { in: shifts.map((s) => s.shift.id) }, ...(p.machineId ? { machineId: p.machineId } : {}) },
    select: STAT_SELECT,
  });
  const storedBy = new Map(stored.map((s) => [`${s.machineId}|${s.shiftInstanceId}`, s]));

  type Pair = { shift: (typeof shifts)[number]; loom: (typeof looms)[number]; s: (typeof stored)[number] | undefined };
  const pairs: Pair[] = [];
  for (const shift of shifts) for (const loom of looms) pairs.push({ shift, loom, s: storedBy.get(`${loom.id}|${shift.shift.id}`) });
  const isSealed = (x: Pair): boolean => x.s?.sealState === "SEALED";
  const kept = pairs.filter((x) => (p.sealState === "OPEN" ? !isSealed(x) : p.sealState === "SEALED" ? isSealed(x) : true));

  // Mühürlü kırılım = SON KUŞAK (defter; katalog değişse etiket değişmez); hat satırları çocuk tablodan — ikisi de toplu.
  const sealedStats = kept.filter(isSealed).map((x) => x.s!);
  const breakdownBy = new Map<string, ShiftBreakdownRow[]>();
  if (opts.includeBreakdown) {
    const genOf = new Map(sealedStats.map((s) => [s.id, s.sealGeneration]));
    for (const ids of chunks(sealedStats.map((s) => s.id))) {
      const bs = await prisma.machineShiftStopBreakdown.findMany({ where: { statId: { in: ids } }, select: { statId: true, sealGeneration: true, reasonCode: true, reasonLabel: true, lossClass: true, beamSlotNull: true, stopCount: true, stopSec: true } });
      for (const { statId, sealGeneration, ...b } of bs) {
        if (genOf.get(statId) !== sealGeneration) continue;
        breakdownBy.set(statId, [...(breakdownBy.get(statId) ?? []), b]);
      }
    }
  }
  const linesBy = new Map<string, Array<Prisma.MachineShiftLineStatGetPayload<{ select: typeof LINE_SELECT }>>>();
  if (opts.byLine) {
    for (const ids of chunks(sealedStats.map((s) => s.id))) {
      const ls = await prisma.machineShiftLineStat.findMany({ where: { statId: { in: ids } }, select: { statId: true, ...LINE_SELECT }, orderBy: [{ statId: "asc" }, { productionLineNo: "asc" }] });
      for (const { statId, ...l } of ls) linesBy.set(statId, [...(linesBy.get(statId) ?? []), l]);
    }
  }
  const liveTerms = await computeShiftTermsMany(
    prisma,
    kept.filter((x) => !isSealed(x)).map((x) => ({ machineId: x.loom.id, shift: { id: x.shift.shift.id, startsAt: x.shift.shift.startsAt, endsAt: x.shift.shift.endsAt, isCancelled: x.shift.shift.isCancelled, plannedBreakMinutes: x.shift.plannedBreakMinutes } })),
    now,
  );

  const rows: Array<ShiftStatRow & ShiftStatRowExtra> = [];
  let live = 0;
  let sealed = 0;
  for (const x of kept) {
    const { shift: { shift }, loom, s } = x;
    const base = { machineId: loom.id, machine: { code: loom.code, name: loom.name }, shiftInstanceId: shift.id, shiftInstance: shift, statId: s?.id ?? null };
    if (s && isSealed(x)) {
      sealed += 1;
      const terms = storedTerms(s);
      const lines = opts.byLine ? storedLineRows(linesBy.get(s.id) ?? [], terms) : undefined;
      rows.push({ ...base, live: false, sealState: "SEALED", sealGeneration: s.sealGeneration, sealedAt: s.sealedAt, terms, kpis: computeMachineKpis(terms), emptyLoom: false, warnings: lines ? lineSumWarning(lines, terms) : [], breakdown: breakdownBy.get(s.id) ?? [], ...(lines ? { lines } : {}) });
      continue;
    }
    const t = liveTerms.get(`${loom.id}|${shift.id}`);
    if (!t) continue;
    live += 1;
    const { breakdown, warnings, emptyLoom, runCount: _r, lines: liveLines, ...terms } = t;
    const lines = opts.byLine ? lineRows(liveLines, terms) : undefined;
    rows.push({ ...base, live: true, sealState: "OPEN", sealGeneration: s?.sealGeneration ?? 0, sealedAt: s?.sealedAt ?? null, terms, kpis: computeMachineKpis(terms), emptyLoom, warnings, breakdown: opts.includeBreakdown ? breakdown : [], ...(lines ? { lines } : {}) });
  }
  return { rows, meta: { total: rows.length, truncated: false, live, sealed } };
}

/** Sayfa boyu varsayılanı ve tavanı — liste sayfalanır, toplam/özet sayfalanmaz. */
export const SHIFT_STAT_PAGE_SIZE = 500;
export const SHIFT_STAT_PAGE_MAX = 5000;

export interface ShiftPageParams { cursor?: string; limit?: number }
export interface ShiftPageMeta { nextCursor: string | null; pageSize: number }

/** Satır anahtarı → opak imleç (sıra: vardiya başlangıcı, tezgah kodu — toplayıcının sırası). */
const encodeCursor = (r: { machineId: string; shiftInstanceId: string }): string => Buffer.from(`${r.shiftInstanceId}|${r.machineId}`, "utf8").toString("base64url");

/**
 * Tam kümeyi sayfalar: `cursor` = önceki sayfanın son satırı (dışlanır). Tanınmayan imleç 400 (fail-closed —
 * aralık/süzgeç değişince eski imleç geçersizdir, sessizce baştan başlamaz). `truncated` = sonraki sayfa VAR.
 */
export function pageShiftRows<R extends { machineId: string; shiftInstanceId: string }>(rows: R[], q: ShiftPageParams): { page: R[]; nextCursor: string | null; pageSize: number } {
  const pageSize = Math.min(Math.max(q.limit ?? SHIFT_STAT_PAGE_SIZE, 1), SHIFT_STAT_PAGE_MAX);
  let start = 0;
  if (q.cursor) {
    const at = rows.findIndex((r) => encodeCursor(r) === q.cursor);
    if (at < 0) throw AppError.badRequest("Sayfa imleci geçersiz — aralık ya da süzgeç değişti, listeyi baştan yükleyin", { code: "INVALID_CURSOR" });
    start = at + 1;
  }
  const page = rows.slice(start, start + pageSize);
  const last = page[page.length - 1];
  const nextCursor = start + pageSize < rows.length && last ? encodeCursor(last) : null;
  return { page, nextCursor, pageSize };
}

/** M1 — karne listesi ucu (kırılımsız; `statId` DÖNER — panel mühür eylemleri onunla, `null` = satır henüz yazılmadı; `byLine` hat satırlarını ekler). */
export async function listShiftStats(p: ShiftStatListParams & ShiftPageParams & { byLine?: boolean }, now = new Date()): Promise<ApiResponse<Array<ShiftStatRow & Pick<ShiftStatRowExtra, "statId" | "lines">>> & { meta: ShiftStatCollectMeta & ShiftPageMeta }> {
  const { byLine, cursor, limit, ...params } = p;
  const { rows, meta } = await collectShiftStatRows(params, { now, byLine });
  const { page, nextCursor, pageSize } = pageShiftRows(rows, { cursor, limit });
  return { success: true, data: page.map(({ breakdown: _b, ...row }) => row), meta: { ...meta, truncated: nextCursor !== null, nextCursor, pageSize } };
}

// =============================================================================
// MAKİNE DURUŞLARI — span defterinden dönem hesabı (D4-A4, ister 5.5; DALGA4 §2.5 md. 5–6)
// =============================================================================
// Kaynak `MachineStopEvent` SPAN DEFTERİ (karne `MachineShiftStat` DEĞİL: karne yalnız tezgahı mühürler,
// kurşun/brode/tambur duruşu oraya hiç girmez). Kapsam TEK helper'dan (`machineStopScopeWhere`;
// `test_makine_durus_raporu` AST'si kopyayı reddeder). Geri alınan (`revokedAt`) duruş girmez; açık duruşun
// bitişi "şimdi"dir ve "sürüyor" sayılır. Süre dönem penceresine kırpılır ve FABRİKA GÜNÜ sınırında
// bölünür (`constants/time`; SQL'de gün kesimi yok). Vardiya kırılımı duruşun AÇILDIĞI vardiyadır.
// =============================================================================
import { MeterPhase, Prisma, ReasonPresetKind, StationKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { factoryDayEndOfKey, factoryYmd } from "../../constants/time";
import { AppError } from "../../utils/app-error";
import { readIdCondition } from "../../utils/query-parser";
import { machineStopRegime, machineStopScopeWhere } from "../helpers/machine-stop-regime.helper";
import type { DateRange } from "./_shared";

/** Bir dönemde okunacak en çok duruş satırı — aşarsa sessiz kesme yerine 400 (aralık daraltılır). */
export const MACHINE_STOP_ROW_LIMIT = 50_000;

export interface MachineStopReportFilters {
  machineId?: string[];
  stationKind?: StationKind[];
  reasonCode?: string[];
}

export interface DaySlice {
  day: string;
  ms: number;
}

/** [start, end) aralığını fabrika günlerine böler (gün anahtarı `YYYY-MM-DD`, süre ms). Boş/ters aralık → []. */
export function splitByFactoryDay(start: Date, end: Date): DaySlice[] {
  const out: DaySlice[] = [];
  let cur = start.getTime();
  const stop = end.getTime();
  while (cur < stop) {
    const day = factoryYmd(new Date(cur));
    const next = Math.min(factoryDayEndOfKey(day).getTime() + 1, stop);
    out.push({ day, ms: next - cur });
    cur = next;
  }
  return out;
}

export interface MachineStopGroup {
  key: string;
  label: string;
  stopCount: number;
  ms: number;
  ongoing: number;
}

export interface MachineStopMachineRow extends MachineStopGroup {
  code: string;
  stationKind: StationKind;
  /** Aynı makinenin dönemdeki aktif (geri alınmamış) çıkış (OUT) sayaç metresi; okuma yoksa 0. */
  outMeters: number;
}

export interface MachineStopReport {
  stopCount: number;
  ms: number;
  ongoing: number;
  unclassified: number;
  machines: MachineStopMachineRow[];
  reasons: MachineStopGroup[];
  stationKinds: MachineStopGroup[];
  /** Vardiya kırılımı (duruşun açıldığı vardiya); hiçbir duruşun vardiyası yoksa boş. */
  shifts: MachineStopGroup[];
  /** Fabrika günü kırılımı (sınırı aşan duruş bölünmüş); yalnız duruşlu günler, artan. */
  days: Array<{ day: string; ms: number }>;
}

export const NO_REASON_KEY = "__sebepsiz";
export const NO_SHIFT_KEY = "__vardiyasiz";

const STATION_KIND_LABEL: Readonly<Record<StationKind, string>> = {
  WEAVING: "Dokuma tezgahı",
  PROCESS_QC: "Kurşun / brode",
  TAMBUR: "Tambur",
  RAW_QC: "Ham kalite",
  SUBCONTRACTOR: "Fason",
  SHIPPING: "Sevkiyat",
  OTHER: "Diğer",
  WARPING: "Devere",
};

export const stationKindLabel = (k: StationKind): string => STATION_KIND_LABEL[k] ?? k;

function bump(map: Map<string, MachineStopGroup>, [key, label]: readonly [string, string], ms: number, ongoing: boolean): MachineStopGroup {
  const g = map.get(key) ?? { key, label, stopCount: 0, ms: 0, ongoing: 0 };
  g.stopCount += 1;
  g.ms += ms;
  if (ongoing) g.ongoing += 1;
  map.set(key, g);
  return g;
}

const bySize = (a: MachineStopGroup, b: MachineStopGroup): number => b.ms - a.ms || b.stopCount - a.stopCount || a.label.localeCompare(b.label, "tr");

/**
 * Dönem `range` (`to` dahil son an) içinde süren duruşlar: kesişen her span pencereye kırpılır. Açık duruşun bitişi
 * `now`; pencere dışında kalan parça sayılmaz. Bir duruş dönemde BİR kez sayılır (günlere bölünse de).
 */
export async function getMachineStopReport(input: { range: DateRange; filters?: MachineStopReportFilters; now?: Date }): Promise<MachineStopReport> {
  const now = input.now ?? new Date();
  const from = input.range.from;
  const endExcl = new Date(input.range.to.getTime() + 1);
  const f = input.filters ?? {};
  const machineCond = readIdCondition(f.machineId);
  const where: Prisma.MachineStopEventWhereInput = {
    AND: [
      machineStopScopeWhere(await machineStopRegime(), f.stationKind ?? []),
      { revokedAt: null },
      { startedAt: { lt: endExcl } },
      { OR: [{ endedAt: null }, { endedAt: { gt: from } }] },
      ...(machineCond ? [{ machineId: machineCond }] : []),
      ...(f.reasonCode && f.reasonCode.length > 0 ? [{ reasonCode: { in: f.reasonCode } }] : []),
    ],
  };
  const rows = await prisma.machineStopEvent.findMany({
    where,
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    take: MACHINE_STOP_ROW_LIMIT + 1,
    select: {
      machineId: true, startedAt: true, endedAt: true, reasonCode: true,
      machine: { select: { name: true, code: true, station: { select: { kind: true } } } },
      shiftInstance: { select: { shiftDefinitionId: true, shiftDefinition: { select: { name: true } } } },
    },
  });
  if (rows.length > MACHINE_STOP_ROW_LIMIT) {
    throw AppError.badRequest("Bu aralıkta çok fazla duruş var; tarih aralığını daraltın.", { code: "REPORT_RANGE_TOO_LARGE", limit: MACHINE_STOP_ROW_LIMIT });
  }

  const codes = [...new Set(rows.map((r) => r.reasonCode).filter((c): c is string => c !== null))];
  const presets = codes.length
    ? await prisma.reasonPreset.findMany({ where: { kind: ReasonPresetKind.MACHINE_STOP, code: { in: codes } }, select: { code: true, label: true } })
    : [];
  const reasonLabel = new Map(presets.map((p) => [p.code, p.label]));

  const machines = new Map<string, MachineStopGroup>();
  const machineMeta = new Map<string, { code: string; stationKind: StationKind }>();
  const reasons = new Map<string, MachineStopGroup>();
  const kinds = new Map<string, MachineStopGroup>();
  const shifts = new Map<string, MachineStopGroup>();
  const days = new Map<string, number>();
  let total = 0;
  let ongoing = 0;
  let unclassified = 0;
  let counted = 0;
  for (const r of rows) {
    const open = r.endedAt === null;
    const start = r.startedAt.getTime() < from.getTime() ? from : r.startedAt;
    const rawEnd = r.endedAt ?? now;
    const end = rawEnd.getTime() > endExcl.getTime() ? endExcl : rawEnd;
    const slices = splitByFactoryDay(start, end);
    const ms = slices.reduce((s, x) => s + x.ms, 0);
    // Pencereye sıfır süreyle değen kapalı duruş dönemde sürmemiştir; açık duruş "şimdi" pencerede ise sayılır.
    if (ms <= 0 && !(open && now.getTime() >= from.getTime())) continue;
    counted += 1;
    total += ms;
    if (open) ongoing += 1;
    if (r.reasonCode === null) unclassified += 1;
    for (const s of slices) days.set(s.day, (days.get(s.day) ?? 0) + s.ms);
    bump(machines, [r.machineId, r.machine.name], ms, open);
    machineMeta.set(r.machineId, { code: r.machine.code, stationKind: r.machine.station.kind });
    bump(reasons, [r.reasonCode ?? NO_REASON_KEY, r.reasonCode === null ? "Sebebi girilmemiş" : reasonLabel.get(r.reasonCode) ?? r.reasonCode], ms, open);
    bump(kinds, [r.machine.station.kind, stationKindLabel(r.machine.station.kind)], ms, open);
    const sd = r.shiftInstance;
    bump(shifts, sd ? [sd.shiftDefinitionId, sd.shiftDefinition.name] : [NO_SHIFT_KEY, "Vardiyası yok"], ms, open);
  }

  const meters = await outMetersOf([...machines.keys()], from, endExcl);
  const anyShift = [...shifts.keys()].some((k) => k !== NO_SHIFT_KEY);
  return {
    stopCount: counted,
    ms: total,
    ongoing,
    unclassified,
    machines: [...machines.values()].sort(bySize).map((g) => ({ ...g, ...machineMeta.get(g.key)!, outMeters: meters.get(g.key) ?? 0 })),
    reasons: [...reasons.values()].sort(bySize),
    stationKinds: [...kinds.values()].sort(bySize),
    shifts: anyShift ? [...shifts.values()].sort(bySize) : [],
    days: [...days.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([day, ms]) => ({ day, ms })),
  };
}

/** Σ aktif OUT metresi makine başına (tek groupBy; `machineId` indeksli). Okuma anı `createdAt` dönem içinde. */
async function outMetersOf(machineIds: string[], from: Date, endExcl: Date): Promise<Map<string, number>> {
  if (machineIds.length === 0) return new Map();
  const grouped = await prisma.rollMeterReading.groupBy({
    by: ["machineId"],
    where: { machineId: { in: machineIds }, phase: MeterPhase.OUT, revokedAt: null, createdAt: { gte: from, lt: endExcl } },
    _sum: { meters: true },
  });
  return new Map(grouped.filter((g) => g.machineId !== null).map((g) => [g.machineId as string, Number(g._sum.meters ?? 0)]));
}

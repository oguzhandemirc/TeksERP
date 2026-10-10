// =============================================================================
// TeksERP — TEZGAH SALONU (okuma): tezgah başına şu anki durum · duruş süresi · bugün %
// =============================================================================
// Canlı ekranın TEK veri ucu (DOKUMA-CANLI-EKRAN §9.6). Kaynak DEFTERLERDİR — duruş
// (`MachineStopEvent`), koşum (`MachineRun`), indirme (`DoffEvent`); audit'ten hiçbir şey
// türetilmez. "Bugün %" = fabrika günü başından ŞU ANA kadarki pencerenin karne terimleri
// (`loom-shift-terms.helper`, tek helper) → oran `loom-efficiency.helper` (tek yazar).
// Tezgah kümesi `LOOM_MACHINE_WHERE`; liste ve özet AYNI kümeden, bellekte doğar.
// Hedef süre ve iletim payı duruş satırındaki DONMUŞ değerdir; pay donmamışsa (özellikten
// önce açılmış duruş) o an geçerli fabrika ayarı kullanılır. Yazma YOK.
// =============================================================================
import type { MachineDataSource, MachineMonitoringState, MachineStopLossClass, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { factoryDayStart } from "../constants/time";
import { LOOM_MACHINE_WHERE, MINOR_STOP_THRESHOLD_SEC } from "../constants/loom-shift";
import { readDokumaEnabled, readTezgahEscalationGraceMinutes } from "./system-setting.service";
import { computeShiftTermsPure, type ShiftBreakdownRow, type ShiftTerms } from "./helpers/loom-shift-terms.helper";
import { computeMachineKpis } from "./helpers/loom-efficiency.helper";
import {
  countFloor,
  escalationDueAt,
  loomStateOf,
  loomStopTier,
  summarizeHalls,
  type FloorCounts,
  type FloorHallSummary,
  type FloorLoomState,
  type LoomStopTier,
} from "./helpers/loom-floor.helper";
import type { ApiResponse } from "../types/api.types";

/** Detay panelinin "son olaylar"ı — tezgah başına en yeni N duruş (liste kırpılır, sayı kırpılmaz). */
export const LOOM_FLOOR_RECENT_STOPS = 12;

export interface LoomFloorOpenStopDto {
  id: string;
  reasonCode: string | null;
  reasonLabel: string | null;
  lossClass: MachineStopLossClass | null;
  startedAt: Date;
  targetMinutes: number | null;
  graceMinutes: number;
  tier: LoomStopTier;
  escalationDueAt: Date | null;
  /** Sebep bekliyor (sınıflandırma borcu). */
  requiresReason: boolean;
  source: MachineDataSource;
}

export interface LoomFloorStopRow {
  id: string;
  reasonCode: string | null;
  lossClass: MachineStopLossClass | null;
  startedAt: Date;
  endedAt: Date | null;
}

export interface LoomFloorJobDto {
  weavingOrderNumber: string;
  itemName: string;
  colorName: string | null;
  colorHex: string | null;
  plannedM: number | null;
}

export interface LoomFloorLoomDto {
  id: string;
  code: string;
  name: string;
  hallId: string;
  hallName: string;
  monitoringState: MachineMonitoringState;
  state: FloorLoomState;
  openStop: LoomFloorOpenStopDto | null;
  today: { potSec: number; aptSec: number; availabilityPct: number | null; stopCount: number; breakdown: ShiftBreakdownRow[] };
  /** Açık koşumun hedef devri ?? künye nominali; ölçülmemişse null. */
  targetUnitsPerMin: number | null;
  /** Açık koşumun dokuma işi — yalnız `dokumaEnabled` açıkken dolar. */
  job: LoomFloorJobDto | null;
  recentStops: LoomFloorStopRow[];
  source: MachineDataSource;
}

export interface LoomFloorDto {
  asOf: Date;
  factoryDayStart: Date;
  shift: { name: string; startsAt: Date; endsAt: Date } | null;
  /** Fabrikanın şu anki iletim payı (dk) — yeni açılan duruşa donacak değer. */
  graceMinutes: number;
  dokumaEnabled: boolean;
  summary: FloorCounts;
  halls: FloorHallSummary[];
  looms: LoomFloorLoomDto[];
}

const LOOM_SELECT = {
  id: true,
  code: true,
  name: true,
  productionLineCount: true,
  station: { select: { id: true, name: true } },
  machineSpec: { select: { monitoringState: true, nominalUnitsPerMin: true } },
} satisfies Prisma.MachineSelect;

const STOP_SELECT = {
  id: true, machineId: true, startedAt: true, endedAt: true, durationSec: true, reasonCode: true, lossClass: true,
  beamSlot: true, source: true, targetMinutes: true, escalationGraceMinutes: true, requiresReason: true,
} satisfies Prisma.MachineStopEventSelect;

const RUN_SELECT = {
  id: true, machineId: true, startedAt: true, endedAt: true, picksAtClose: true, producedM: true,
  targetUnitsPerMin: true, unitsPerCm: true, productionLineNo: true, weavingOrderId: true,
} satisfies Prisma.MachineRunSelect;

type StopRow = Prisma.MachineStopEventGetPayload<{ select: typeof STOP_SELECT }>;
type RunRow = Prisma.MachineRunGetPayload<{ select: typeof RUN_SELECT }>;
type LoomRow = Prisma.MachineGetPayload<{ select: typeof LOOM_SELECT }>;

const dec = (d: Prisma.Decimal | null): number | null => (d === null ? null : Number(d));

function groupBy<T extends { machineId: string }>(rows: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const list = m.get(r.machineId) ?? [];
    list.push(r);
    m.set(r.machineId, list);
  }
  return m;
}

interface FloorSources {
  looms: LoomRow[];
  stops: StopRow[];
  runs: RunRow[];
  doffs: Array<{ machineId: string; counterSource: MachineDataSource }>;
  labelOf: Map<string, string>;
  jobs: Map<string, LoomFloorJobDto>;
}

/** Pencereyle (gün başı → şimdi) KESİŞEN defter satırları — kırpma terim helper'ında. */
async function loadSources(dayStart: Date, now: Date, withJobs: boolean): Promise<FloorSources> {
  const looms = await prisma.machine.findMany({ where: LOOM_MACHINE_WHERE, select: LOOM_SELECT, orderBy: { code: "asc" } });
  const ids = looms.map((l) => l.id);
  const intersects = { machineId: { in: ids }, revokedAt: null, startedAt: { lt: now }, OR: [{ endedAt: null }, { endedAt: { gt: dayStart } }] };
  const stops = ids.length ? await prisma.machineStopEvent.findMany({ where: intersects, select: STOP_SELECT, orderBy: { startedAt: "asc" } }) : [];
  const runs = ids.length ? await prisma.machineRun.findMany({ where: intersects, select: RUN_SELECT, orderBy: { startedAt: "asc" } }) : [];
  const doffs = ids.length
    ? await prisma.doffEvent.findMany({ where: { machineId: { in: ids }, revokedAt: null, doffedAt: { gte: dayStart, lt: now } }, select: { machineId: true, counterSource: true } })
    : [];
  const codes = [...new Set(stops.map((s) => s.reasonCode).filter((c): c is string => c !== null))];
  const presets = codes.length
    ? await prisma.reasonPreset.findMany({ where: { kind: "MACHINE_STOP", code: { in: codes } }, select: { code: true, label: true } })
    : [];
  const orderIds = withJobs ? [...new Set(runs.filter((r) => r.endedAt === null && r.weavingOrderId).map((r) => r.weavingOrderId!))] : [];
  const orders = orderIds.length
    ? await prisma.weavingOrder.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, weavingOrderNumber: true, plannedM: true, item: { select: { name: true } }, color: { select: { name: true, hex: true } } },
      })
    : [];
  const jobs = new Map(orders.map((o) => [o.id, {
    weavingOrderNumber: o.weavingOrderNumber, itemName: o.item.name, colorName: o.color?.name ?? null, colorHex: o.color?.hex ?? null, plannedM: dec(o.plannedM),
  }]));
  return { looms, stops, runs, doffs, labelOf: new Map(presets.map((p) => [p.code, p.label])), jobs };
}

interface LoomDayRows { stops: StopRow[]; runs: RunRow[]; doffSources: MachineDataSource[] }

function todayTerms(loom: LoomRow, { stops, runs, doffSources }: LoomDayRows, src: FloorSources, w: { dayStart: Date; now: Date }): ShiftTerms {
  return computeShiftTermsPure({
    // Gün penceresinde mola takvimi dağıtılmaz (vardiya karnesinin işi); POT = takvim − çalışma dışı.
    window: { startsAt: w.dayStart, endsAt: w.now, isCancelled: false, plannedBreakMinutes: 0 },
    stops: stops.map((s) => ({ ...s, reasonLabel: s.reasonCode ? (src.labelOf.get(s.reasonCode) ?? null) : null })),
    runs: runs.map((r) => ({ ...r, producedM: dec(r.producedM), unitsPerCm: dec(r.unitsPerCm) })),
    doffSources,
    spec: loom.machineSpec,
    productionLineCount: loom.productionLineCount,
    now: w.now,
    stopThresholdSec: MINOR_STOP_THRESHOLD_SEC,
  });
}

function openStopDto(s: StopRow, src: FloorSources, currentGrace: number, now: Date): LoomFloorOpenStopDto {
  const clock = { startedAt: s.startedAt, targetMinutes: s.targetMinutes, graceMinutes: s.escalationGraceMinutes ?? currentGrace, lossClass: s.lossClass };
  return {
    id: s.id,
    reasonCode: s.reasonCode,
    reasonLabel: s.reasonCode ? (src.labelOf.get(s.reasonCode) ?? null) : null,
    lossClass: s.lossClass,
    startedAt: s.startedAt,
    targetMinutes: s.targetMinutes,
    graceMinutes: clock.graceMinutes,
    tier: loomStopTier(clock, now),
    escalationDueAt: escalationDueAt(clock),
    requiresReason: s.requiresReason && s.reasonCode === null,
    source: s.source,
  };
}

function loomDto(loom: LoomRow, src: FloorSources, ctx: { dayStart: Date; now: Date; grace: number; byStop: Map<string, StopRow[]>; byRun: Map<string, RunRow[]>; byDoff: Map<string, Array<{ machineId: string; counterSource: MachineDataSource }>> }): { dto: LoomFloorLoomDto; terms: ShiftTerms } {
  const stops = ctx.byStop.get(loom.id) ?? [];
  const runs = ctx.byRun.get(loom.id) ?? [];
  const terms = todayTerms(loom, { stops, runs, doffSources: (ctx.byDoff.get(loom.id) ?? []).map((d) => d.counterSource) }, src, ctx);
  const open = stops.find((s) => s.endedAt === null) ?? null;
  const monitoringState = loom.machineSpec?.monitoringState ?? "OFF";
  const openRun = runs.filter((r) => r.endedAt === null).sort((a, b) => a.productionLineNo - b.productionLineNo)[0] ?? null;
  const recent = [...stops].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, LOOM_FLOOR_RECENT_STOPS);
  return {
    terms,
    dto: {
      id: loom.id,
      code: loom.code,
      name: loom.name,
      hallId: loom.station.id,
      hallName: loom.station.name,
      monitoringState,
      state: loomStateOf(monitoringState === "LIVE", open !== null),
      openStop: open ? openStopDto(open, src, ctx.grace, ctx.now) : null,
      today: {
        potSec: terms.potSec, aptSec: terms.aptSec, availabilityPct: computeMachineKpis(terms).availabilityPct,
        stopCount: terms.stopCount, breakdown: terms.breakdown,
      },
      targetUnitsPerMin: openRun?.targetUnitsPerMin ?? loom.machineSpec?.nominalUnitsPerMin ?? null,
      job: openRun?.weavingOrderId ? (src.jobs.get(openRun.weavingOrderId) ?? null) : null,
      recentStops: recent.map((s) => ({ id: s.id, reasonCode: s.reasonCode, lossClass: s.lossClass, startedAt: s.startedAt, endedAt: s.endedAt })),
      source: terms.source,
    },
  };
}

/** Salon durumu — `now` bekçinin sabit saat vermesi için parametredir. */
export async function getLoomFloor(now: Date = new Date()): Promise<ApiResponse<LoomFloorDto>> {
  const dayStart = factoryDayStart(now);
  const dokumaEnabled = await readDokumaEnabled();
  const grace = await readTezgahEscalationGraceMinutes();
  const src = await loadSources(dayStart, now, dokumaEnabled);
  const shift = await prisma.shiftInstance.findFirst({
    where: { startsAt: { lte: now }, endsAt: { gt: now }, isCancelled: false },
    select: { startsAt: true, endsAt: true, shiftDefinition: { select: { name: true } } },
    orderBy: { startsAt: "desc" },
  });
  const ctx = { dayStart, now, grace, byStop: groupBy(src.stops), byRun: groupBy(src.runs), byDoff: groupBy(src.doffs) };
  const built = src.looms.map((l) => loomDto(l, src, ctx));
  const cores = built.map(({ dto, terms }) => ({
    hallId: dto.hallId, hallName: dto.hallName, state: dto.state,
    openStop: dto.openStop ? { lossClass: dto.openStop.lossClass, tier: dto.openStop.tier } : null,
    terms,
  }));
  return {
    success: true,
    data: {
      asOf: now,
      factoryDayStart: dayStart,
      shift: shift ? { name: shift.shiftDefinition.name, startsAt: shift.startsAt, endsAt: shift.endsAt } : null,
      graceMinutes: grace,
      dokumaEnabled,
      summary: countFloor(cores),
      halls: summarizeHalls(cores),
      looms: built.map((b) => b.dto),
    },
  };
}

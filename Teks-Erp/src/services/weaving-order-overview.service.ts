// =============================================================================
// DOKUMA İŞİ — GENEL BAKIŞ (salt okuma): "bu iş şu an ne hâlde?"
// =============================================================================
// Panelin sağ paneli için TEK uç (`GET /api/weaving-orders/:id/overview`). Yazma YOK, tx YOK.
// Kaynak DEFTERLERDİR (koşum · indirme · top · levent); yüklemler kendi helper'larından gelir:
// açık koşum `OPEN_RUN_WHERE`, işin topu `rollsOfWeavingOrderWhere` (detayın `producedRollCount`u
// ile aynı where), canlı operatör `liveMachineOperators`, takılı levent + kalan `mountedBeamViewsTx`,
// levent kalanı `remainingByBeam`. İki metre AYRI alandır ve birbirinin yerine geçmez: koşum kapanış
// metresi (`producedM`) ile doğan topların ölçülen metresi (`initialQty`); ölçülmeyen null, 0 değil.
// Listeler sabit tavanla kırpılır, SAYI kırpılmaz (`total` + `truncated`).
// =============================================================================
import type { MachineStopLossClass, Prisma, RollStatus, WarpBeamStatus, WeavingExecutionKind } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { readDevereEnabled, readDevereMountTracking } from "./system-setting.service";
import { OPEN_RUN_WHERE, WEAVING_ORDER_SELECT, toWeavingOrderDto, type WeavingOrderDto } from "./helpers/weaving-order-input.helper";
import { countRollsOfWeavingOrder, receivedMetersByWeavingOrder, rollsOfWeavingOrderWhere } from "./helpers/weaving-order-of-roll.helper";
import { liveMachineOperators } from "./helpers/work-session.helper";
import { mountedBeamViewsTx, type MountedBeamView } from "./helpers/warp-beam-mount.helper";
import { remainingByBeam } from "./helpers/warp-beam.helper";

/** Liste tavanları — kırpılan liste `truncated: true` + `total` taşır. */
export const OVERVIEW_LIVE_RUN_CAP = 50;
export const OVERVIEW_RECENT_RUN_CAP = 10;
export const OVERVIEW_RECENT_DOFF_CAP = 10;
export const OVERVIEW_BEAM_CAP = 20;
/** Bir indirmenin dökülen top listesi tavanı (indirme başına parça sayısı küçüktür; yine de sınırsız değil). */
const DOFF_ROLL_CAP = 20;

export interface CappedList<T> { items: T[]; total: number; truncated: boolean }
interface MachineRef { id: string; code: string; name: string }

export interface OverviewProgress {
  /** Hedef metre; null = açık uçlu iş. */
  plannedM: number | null;
  /** Bu işten indirme yoluyla doğan top sayısı — detayın `producedRollCount`u ile AYNI yüklem. */
  rollCount: number;
  /** Aynı topların ölçülen ilk metresi (Σ `initialQty`); top yoksa null. */
  rollMeters: number | null;
  /** Kapanmış ∧ geri alınmamış koşumların kapanış metresi (Σ `producedM`); hiç ölçülmemişse null. */
  runMeters: number | null;
  closedRunCount: number;
  /** Kapanmış ama metresi girilmemiş koşum sayısı — `runMeters` bunları içermez. */
  unmeasuredRunCount: number;
  /** Geri alınmamış indirme sayısı. */
  doffCount: number;
  /** Fasonda dokunan işte kabul edilen metre (makbuz zinciri); kendi tezgahımızdaki işte null. */
  fasonReceivedM: number | null;
}

export interface OverviewLiveRun {
  id: string;
  machine: MachineRef;
  productionLineNo: number;
  startedAt: Date;
  targetUnitsPerMin: number | null;
  /** Bu koşuma bağlı, geri alınmamış indirme sayısı. */
  doffCount: number;
  /** Tezgahta şu an açık duruş (iş değil makine durur); yoksa null. */
  openStop: { id: string; reasonCode: string | null; reasonLabel: string | null; lossClass: MachineStopLossClass | null; startedAt: Date } | null;
  /** Tezgahın canlı tablet oturumu; yoksa null. */
  operator: { name: string; since: Date } | null;
  /** Takılı leventler — yalnız devere ∧ `devere.mountTracking` açıkken dizi; kapalıyken null. */
  beams: MountedBeamView[] | null;
}

export interface OverviewRecentRun {
  id: string;
  machine: MachineRef;
  productionLineNo: number;
  startedAt: Date;
  endedAt: Date | null;
  producedM: number | null;
  revokedAt: Date | null;
  revokeReason: string | null;
}

export interface OverviewDoff {
  id: string;
  code: string;
  machine: MachineRef;
  productionLineNo: number;
  doffedAt: Date;
  pieceCount: number;
  // Barkod null olabilir (barkodsuz top); uydurulmaz.
  rolls: Array<{ id: string; barcode: string | null; initialQty: number; status: RollStatus }>;
}

export interface OverviewBeam {
  id: string;
  beamNo: string;
  status: WarpBeamStatus;
  plannedLengthM: number;
  remainingM: number;
  warpSpecCode: string;
  currentMachine: { id: string; code: string } | null;
}

export interface WeavingOrderOverviewDto {
  asOf: Date;
  order: WeavingOrderDto;
  executionKind: WeavingExecutionKind;
  progress: OverviewProgress;
  liveRuns: CappedList<OverviewLiveRun>;
  recentRuns: CappedList<OverviewRecentRun>;
  recentDoffs: CappedList<OverviewDoff>;
  /** İşe bağlı leventler — devere kapalıysa null (bölüm çizilmez). */
  beams: CappedList<OverviewBeam> | null;
  /** Takılı levent bağı ölçülüyor mu (devere ∧ `devere.mountTracking`). */
  beamTracking: boolean;
}

const MACHINE_SELECT = { select: { id: true, code: true, name: true } } as const;
const num = (d: Prisma.Decimal | null): number | null => (d === null ? null : Number(d));
const capped = <T>(items: T[], total: number): CappedList<T> => ({ items, total, truncated: total > items.length });

/** Kapanmış ∧ geri alınmamış koşum yüklemi (koşum metresi yalnız bunlardan). */
const closedRunWhere = (weavingOrderId: string): Prisma.MachineRunWhereInput => ({ weavingOrderId, endedAt: { not: null }, revokedAt: null });
/** "Geçmiş koşum" = açık olmayan (kapanmış ya da geri alınmış). */
const pastRunWhere = (weavingOrderId: string): Prisma.MachineRunWhereInput => ({ weavingOrderId, NOT: OPEN_RUN_WHERE });
const doffsOfOrderWhere = (weavingOrderId: string): Prisma.DoffEventWhereInput => ({ revokedAt: null, machineRun: { weavingOrderId } });

async function loadProgress(id: string, plannedM: number | null, kind: WeavingExecutionKind): Promise<OverviewProgress> {
  const rolls = await prisma.roll.aggregate({ where: rollsOfWeavingOrderWhere(id), _count: { _all: true }, _sum: { initialQty: true } });
  const runs = await prisma.machineRun.aggregate({ where: closedRunWhere(id), _count: { _all: true }, _sum: { producedM: true } });
  const unmeasuredRunCount = await prisma.machineRun.count({ where: { ...closedRunWhere(id), producedM: null } });
  const doffCount = await prisma.doffEvent.count({ where: doffsOfOrderWhere(id) });
  const fason = kind === "SUBCONTRACTED" ? ((await receivedMetersByWeavingOrder(prisma, [id])).get(id) ?? 0) : null;
  const closedRunCount = runs._count._all;
  return {
    plannedM,
    rollCount: rolls._count._all,
    rollMeters: rolls._count._all > 0 ? num(rolls._sum.initialQty) : null,
    runMeters: closedRunCount > unmeasuredRunCount ? num(runs._sum.producedM) : null,
    closedRunCount,
    unmeasuredRunCount,
    doffCount,
    fasonReceivedM: fason,
  };
}

async function loadLiveRuns(id: string, now: Date, beamTracking: boolean): Promise<CappedList<OverviewLiveRun>> {
  const where: Prisma.MachineRunWhereInput = { weavingOrderId: id, ...OPEN_RUN_WHERE };
  const rows = await prisma.machineRun.findMany({
    where,
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    take: OVERVIEW_LIVE_RUN_CAP,
    select: { id: true, productionLineNo: true, startedAt: true, targetUnitsPerMin: true, machine: MACHINE_SELECT, _count: { select: { doffEvents: { where: { revokedAt: null } } } } },
  });
  const total = rows.length < OVERVIEW_LIVE_RUN_CAP ? rows.length : await prisma.machineRun.count({ where });
  const machineIds = [...new Set(rows.map((r) => r.machine.id))];
  const stops = machineIds.length
    ? await prisma.machineStopEvent.findMany({
        where: { machineId: { in: machineIds }, endedAt: null, revokedAt: null },
        select: { id: true, machineId: true, reasonCode: true, lossClass: true, startedAt: true },
      })
    : [];
  const codes = [...new Set(stops.map((s) => s.reasonCode).filter((c): c is string => c !== null))];
  const presets = codes.length ? await prisma.reasonPreset.findMany({ where: { kind: "MACHINE_STOP", code: { in: codes } }, select: { code: true, label: true } }) : [];
  const labelOf = new Map(presets.map((p) => [p.code, p.label]));
  const stopOf = new Map(stops.map((s) => [s.machineId, s]));
  const operators = await liveMachineOperators(machineIds, now);
  const beamsBy = beamTracking ? await mountedBeamViewsTx(prisma, machineIds) : null;
  const items = rows.map((r): OverviewLiveRun => {
    const s = stopOf.get(r.machine.id);
    return {
      id: r.id, machine: r.machine, productionLineNo: r.productionLineNo, startedAt: r.startedAt, targetUnitsPerMin: r.targetUnitsPerMin,
      doffCount: r._count.doffEvents,
      openStop: s ? { id: s.id, reasonCode: s.reasonCode, reasonLabel: s.reasonCode ? (labelOf.get(s.reasonCode) ?? null) : null, lossClass: s.lossClass, startedAt: s.startedAt } : null,
      operator: operators.get(r.machine.id) ?? null,
      beams: beamsBy ? (beamsBy.get(r.machine.id) ?? []) : null,
    };
  });
  return capped(items, total);
}

async function loadRecentRuns(id: string): Promise<CappedList<OverviewRecentRun>> {
  const where = pastRunWhere(id);
  const rows = await prisma.machineRun.findMany({
    where,
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: OVERVIEW_RECENT_RUN_CAP,
    select: { id: true, productionLineNo: true, startedAt: true, endedAt: true, producedM: true, revokedAt: true, revokeReason: true, machine: MACHINE_SELECT },
  });
  const total = await prisma.machineRun.count({ where });
  return capped(rows.map((r) => ({ ...r, producedM: num(r.producedM) })), total);
}

async function loadRecentDoffs(id: string): Promise<CappedList<OverviewDoff>> {
  const where = doffsOfOrderWhere(id);
  const rows = await prisma.doffEvent.findMany({
    where,
    orderBy: [{ doffedAt: "desc" }, { id: "desc" }],
    take: OVERVIEW_RECENT_DOFF_CAP,
    select: {
      id: true, code: true, productionLineNo: true, doffedAt: true, pieceCount: true, machine: MACHINE_SELECT,
      rolls: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: DOFF_ROLL_CAP, select: { id: true, barcode: true, initialQty: true, status: true } },
    },
  });
  const total = await prisma.doffEvent.count({ where });
  return capped(rows.map((d) => ({ ...d, rolls: d.rolls.map((r) => ({ ...r, initialQty: Number(r.initialQty) })) })), total);
}

async function loadBeams(id: string): Promise<CappedList<OverviewBeam>> {
  const where: Prisma.WarpBeamWhereInput = { weavingOrderId: id };
  const rows = await prisma.warpBeam.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: OVERVIEW_BEAM_CAP,
    select: { id: true, beamNo: true, status: true, plannedLengthM: true, warpSpec: { select: { code: true } }, currentMachine: { select: { id: true, code: true } } },
  });
  const total = await prisma.warpBeam.count({ where });
  const remaining = await remainingByBeam(prisma, rows.map((r) => r.id));
  const items = rows.map((r) => ({
    id: r.id, beamNo: r.beamNo, status: r.status, plannedLengthM: Number(r.plannedLengthM),
    remainingM: remaining.get(r.id) ?? 0, warpSpecCode: r.warpSpec.code, currentMachine: r.currentMachine,
  }));
  return capped(items, total);
}

/** Genel bakış — `now` bekçinin sabit saat vermesi için parametredir. */
export async function getWeavingOrderOverview(id: string, now: Date = new Date()): Promise<ApiResponse<WeavingOrderOverviewDto>> {
  const row = await prisma.weavingOrder.findUnique({ where: { id }, select: WEAVING_ORDER_SELECT });
  if (!row) throw AppError.notFound("Dokuma iş emri bulunamadı");
  const order: WeavingOrderDto = { ...toWeavingOrderDto(row), producedRollCount: await countRollsOfWeavingOrder(prisma, id) };
  const devere = await readDevereEnabled();
  const beamTracking = devere && (await readDevereMountTracking());
  return {
    success: true,
    data: {
      asOf: now,
      order,
      executionKind: row.executionKind,
      progress: await loadProgress(id, order.plannedM, row.executionKind),
      liveRuns: await loadLiveRuns(id, now, beamTracking),
      recentRuns: await loadRecentRuns(id),
      recentDoffs: await loadRecentDoffs(id),
      beams: devere ? await loadBeams(id) : null,
      beamTracking,
    },
  };
}

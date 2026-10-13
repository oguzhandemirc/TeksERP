// =============================================================================
// TeksERP — TEZGAH SALONU (okuma): tezgah başına şu anki durum · duruş süresi · bugün %
// =============================================================================
// Canlı ekranın TEK veri ucu (DOKUMA-CANLI-EKRAN §9.6). Kaynak DEFTERLERDİR — duruş
// (`MachineStopEvent`), koşum (`MachineRun`), indirme (`DoffEvent`), takılı levent (`mountedBeamViewsTx`,
// `GET /warp-beams/mounted` ile aynı helper); audit'ten hiçbir şey
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
import { readDevereEnabled, readDevereMountTracking, readDokumaEnabled, readTezgahAlarmNoShiftMode, resolveTezgahAlarmUnclassifiedTarget, readTezgahEscalationGraceMinutes, resolveTezgahAlarmEnabled, TEZGAH_ALARM_NO_SHIFT_MODES, type TezgahAlarmNoShiftMode } from "./system-setting.service";
import { ACTIVE_ALARM_STATES } from "./loom-alarm.service";
import { mountedBeamViewsTx, type MountedBeamView } from "./helpers/warp-beam-mount.helper";
import { liveMachineOperators } from "./helpers/work-session.helper";
import { computeShiftTermsPure, type ShiftBreakdownRow, type ShiftTerms, type SourceBucket } from "./helpers/loom-shift-terms.helper";
import { computeMachineKpis } from "./helpers/loom-efficiency.helper";
import { clockShiftsFrom, loadAlarmShiftFacts, loadClockShiftWindows, type CurrentShift } from "./helpers/loom-alarm-shift.helper";
import {
  alarmClockStart,
  alarmEnableBlocked,
  alarmShiftNotice,
  countFloor,
  escalationDueAt,
  floorStateSourceOf,
  floorStopTier,
  loomStateOf,
  loomStopTier,
  stopClockOf,
  stopTargetMinutes,
  summarizeHalls,
  type FloorCounts,
  type FloorHallSummary,
  type FloorLoomState,
  type AlarmShiftNotice,
  type LoomStopTier,
  type ShiftWindow,
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
  /** Hedef saatinin başladığı an (alarm motoruyla aynı): vardiya dışında açılıp vardiyaya taşan duruşta vardiya başı, yoksa `startedAt`. */
  clockStartedAt: Date;
  targetMinutes: number | null;
  graceMinutes: number;
  /** Saatten kademe; canlı alarm varsa çaldığı kademe öne geçer (`ESCALATED` yalnız K2 çaldıysa). */
  tier: LoomStopTier;
  /** Canlı alarmda alarmın DONMUŞ K2 vadesi, yoksa saatten (başlangıç + hedef + pay). */
  escalationDueAt: Date | null;
  /** Canlı alarm (alarm bayrağı açıkken) — alarm sayfasına derin bağlantı. */
  alarmId: string | null;
  /** Sebep bekliyor (sınıflandırma borcu). */
  requiresReason: boolean;
  source: MachineDataSource;
  /** Duruşu elle açan (B3); null = bilinmiyor (sinyal ya da B3 öncesi satır). */
  openedByName: string | null;
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

/** Hat başına açık koşum (salon "İş ver / Değiştir / Bitir" eylemlerinin hedefi). */
export interface LoomFloorOpenRunDto {
  id: string;
  productionLineNo: number;
  weavingOrderId: string | null;
  weavingOrderNumber: string | null;
  startedAt: Date;
}

export interface LoomFloorLoomDto {
  id: string;
  code: string;
  name: string;
  /** Tezgahın üretim hattı sayısı (çift enli = 2). */
  productionLineCount: number;
  hallId: string;
  hallName: string;
  monitoringState: MachineMonitoringState;
  collectorSilentSince: Date | null; // kart SESSİZ (D4) — dolu: son görülme; NULL = kart yok ya da canlı
  state: FloorLoomState;
  /** Durumun kaynağı (karne kovası): LIVE "olculen" · elle kayıt "elle" · "simule" · kayıt yok "cikarim" (= UNMONITORED). */
  stateSource: SourceBucket;
  openStop: LoomFloorOpenStopDto | null;
  today: { potSec: number; aptSec: number; availabilityPct: number | null; stopCount: number; breakdown: ShiftBreakdownRow[] };
  /** Açık koşumun hedef devri ?? künye nominali; ölçülmemişse null. */
  targetUnitsPerMin: number | null;
  /** Açık koşumun dokuma işi — yalnız `dokumaEnabled` açıkken dolar. */
  job: LoomFloorJobDto | null;
  /** HER hattın açık koşumu (hat sırasıyla) — yalnız `dokumaEnabled` açıkken dizi; kapalıyken null. `job` ilk hattınkidir. */
  openRuns: LoomFloorOpenRunDto[] | null;
  /** Takılı leventler (yuva sırasıyla) — yalnız devere + levent tezgah bağı defteri açıkken dizi; kapalıyken null. */
  beams: MountedBeamView[] | null;
  /** Tezgahta tabletten oturum açmış operatör (D5; açık ve hareketsizlik süresi dolmamış oturum); yoksa null. */
  operator: { name: string; since: Date } | null;
  recentStops: LoomFloorStopRow[];
  source: MachineDataSource;
}

export interface LoomFloorDto {
  asOf: Date;
  factoryDayStart: Date;
  shift: { name: string; startsAt: Date; endsAt: Date } | null;
  /** Alarm açıkken vardiyasızlık uyarısı (`alarmShiftNotice`, ayar ekranıyla aynı karar); yoksa null. */
  alarmNotice: AlarmShiftNotice | null;
  /** Fabrikanın şu anki iletim payı (dk) — yeni açılan duruşa donacak değer. */
  graceMinutes: number;
  dokumaEnabled: boolean;
  /** Levent tezgah bağı ölçülüyor mu (devere ∧ `devere.mountTracking`) — kapalıyken her tezgahta `beams: null`. */
  beamTracking: boolean;
  /** Sunucu toplu duruş uçlarını (`/api/machine-stops/bulk/*`; "Sebep ata" `bulk/classify*` ayrıca) tanıyor — alanı görmeyen panel eski sunucu sayar, eylemi pasif çizer. */
  bulkStopActions: true;
  bulkClassifyAction: true;
  summary: FloorCounts;
  halls: FloorHallSummary[];
  looms: LoomFloorLoomDto[];
}

const LOOM_SELECT = {
  id: true, code: true, name: true, productionLineCount: true,
  station: { select: { id: true, name: true } },
  machineSpec: { select: { monitoringState: true, nominalUnitsPerMin: true } },
  collectorLinks: { select: { collector: { select: { silentSince: true, revokedAt: true } } } },
} satisfies Prisma.MachineSelect;

const STOP_SELECT = {
  id: true, machineId: true, startedAt: true, endedAt: true, durationSec: true, reasonCode: true, lossClass: true,
  beamSlot: true, source: true, targetMinutes: true, escalationGraceMinutes: true, requiresReason: true,
  alarm: { select: { id: true, state: true, tier: true, k2DueAt: true } },
  shiftInstance: { select: { isCancelled: true } }, openedBy: { select: { fullName: true } },
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
  withJobs: boolean;
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
  return { looms, stops, runs, doffs, labelOf: new Map(presets.map((p) => [p.code, p.label])), jobs, withJobs };
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

function openStopDto(s: StopRow, src: FloorSources, ctx: { grace: number; unclassifiedTarget: number | null; alarmEnabled: boolean; noShiftMode: TezgahAlarmNoShiftMode; shifts: ShiftWindow[] }, now: Date): LoomFloorOpenStopDto {
  // Alarm bayrağı kapalıyken alarm satırı okunmaz (bugünkü davranış); yalnız CANLI alarm kademeyi taşır.
  const alarm = ctx.alarmEnabled && s.alarm && ACTIVE_ALARM_STATES.includes(s.alarm.state) ? s.alarm : null;
  // Saat alarm motoruyla aynı başlangıçtan: vardiyaya taşan duruşta vardiya başı.
  const clock = stopClockOf(s, alarmClockStart(s, ctx.shifts, now, ctx.noShiftMode), stopTargetMinutes(s, ctx.unclassifiedTarget), s.escalationGraceMinutes ?? ctx.grace);
  return {
    id: s.id,
    reasonCode: s.reasonCode,
    reasonLabel: s.reasonCode ? (src.labelOf.get(s.reasonCode) ?? null) : null,
    lossClass: s.lossClass,
    startedAt: s.startedAt,
    clockStartedAt: clock.startedAt,
    targetMinutes: clock.targetMinutes,
    graceMinutes: clock.graceMinutes,
    tier: floorStopTier(loomStopTier(clock, now), alarm),
    escalationDueAt: alarm ? alarm.k2DueAt : escalationDueAt(clock),
    alarmId: alarm?.id ?? null,
    requiresReason: s.requiresReason && s.reasonCode === null,
    source: s.source, openedByName: s.openedBy?.fullName ?? null,
  };
}

function loomDto(loom: LoomRow, src: FloorSources, ctx: { dayStart: Date; now: Date; grace: number; unclassifiedTarget: number | null; alarmEnabled: boolean; noShiftMode: TezgahAlarmNoShiftMode; shifts: ShiftWindow[]; beamsBy: Map<string, MountedBeamView[]> | null; byStop: Map<string, StopRow[]>; byRun: Map<string, RunRow[]>; byDoff: Map<string, Array<{ machineId: string; counterSource: MachineDataSource }>>; operators: Map<string, { name: string; since: Date }> }): { dto: LoomFloorLoomDto; terms: ShiftTerms } {
  const stops = ctx.byStop.get(loom.id) ?? [];
  const runs = ctx.byRun.get(loom.id) ?? [];
  const terms = todayTerms(loom, { stops, runs, doffSources: (ctx.byDoff.get(loom.id) ?? []).map((d) => d.counterSource) }, src, ctx);
  const open = stops.find((s) => s.endedAt === null) ?? null;
  const monitoringState = loom.machineSpec?.monitoringState ?? "OFF";
  const stateSource = floorStateSourceOf(monitoringState, terms.source);
  const openRun = runs.filter((r) => r.endedAt === null).sort((a, b) => a.productionLineNo - b.productionLineNo)[0] ?? null;
  const recent = [...stops].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, LOOM_FLOOR_RECENT_STOPS);
  return {
    terms,
    dto: {
      id: loom.id,
      code: loom.code,
      name: loom.name,
      productionLineCount: loom.productionLineCount,
      hallId: loom.station.id,
      hallName: loom.station.name,
      monitoringState,
      collectorSilentSince: loom.collectorLinks.find((l) => l.collector.revokedAt === null)?.collector.silentSince ?? null,
      state: loomStateOf(stateSource, open !== null),
      stateSource,
      openStop: open ? openStopDto(open, src, ctx, ctx.now) : null,
      today: {
        potSec: terms.potSec, aptSec: terms.aptSec, availabilityPct: computeMachineKpis(terms).availabilityPct,
        stopCount: terms.stopCount, breakdown: terms.breakdown,
      },
      targetUnitsPerMin: openRun?.targetUnitsPerMin ?? loom.machineSpec?.nominalUnitsPerMin ?? null,
      job: openRun?.weavingOrderId ? (src.jobs.get(openRun.weavingOrderId) ?? null) : null,
      openRuns: src.withJobs
        ? runs
            .filter((r) => r.endedAt === null)
            .sort((a, b) => a.productionLineNo - b.productionLineNo)
            .map((r) => ({
              id: r.id, productionLineNo: r.productionLineNo, weavingOrderId: r.weavingOrderId, startedAt: r.startedAt,
              weavingOrderNumber: r.weavingOrderId ? (src.jobs.get(r.weavingOrderId)?.weavingOrderNumber ?? null) : null,
            }))
        : null,
      beams: ctx.beamsBy ? (ctx.beamsBy.get(loom.id) ?? []) : null,
      operator: ctx.operators.get(loom.id) ?? null,
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
  const unclassifiedTarget = await resolveTezgahAlarmUnclassifiedTarget();
  const src = await loadSources(dayStart, now, dokumaEnabled);
  const beamTracking = (await readDevereEnabled()) && (await readDevereMountTracking());
  const beamsBy = beamTracking ? await mountedBeamViewsTx(prisma, src.looms.map((l) => l.id)) : null;
  const alarm = await alarmShiftState(now);
  const { alarmEnabled, mode: noShiftMode } = alarm;
  const shifts = await loadClockShiftWindows(prisma, clockShiftsFrom(src.stops.filter((s) => s.endedAt === null)), now);
  const ctx = { dayStart, now, grace, unclassifiedTarget, alarmEnabled, noShiftMode, shifts, beamsBy, byStop: groupBy(src.stops), byRun: groupBy(src.runs), byDoff: groupBy(src.doffs), operators: await liveMachineOperators(src.looms.map((l) => l.id), now) };
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
      shift: alarm.currentShift,
      alarmNotice: alarm.notice,
      graceMinutes: grace,
      dokumaEnabled, beamTracking,
      bulkStopActions: true, bulkClassifyAction: true,
      summary: countFloor(cores),
      halls: summarizeHalls(cores),
      looms: built.map((b) => b.dto),
    },
  };
}

export interface AlarmShiftStatusDto {
  /** Etkin alarm (tezgah modülü ∧ `tezgah.alarmEnabled`). */
  alarmEnabled: boolean;
  mode: TezgahAlarmNoShiftMode;
  /** En az bir aktif vardiya tanımı var. */
  shiftDefined: boolean;
  /** Şu an süren canlı vardiya; yoksa null. */
  currentShift: CurrentShift | null;
  /** KAYITLI duruma göre uyarı (salon şeridiyle aynı karar). */
  notice: AlarmShiftNotice | null;
  /** Alarmı AÇMANIN engelli olduğu kipler (şu anki vardiya tanımına göre) — panel taslak kipi buna bakar. */
  enableBlockedModes: TezgahAlarmNoShiftMode[];
}

/** Ayar ekranı ve Tezgah Salonu'nun ortak okuması: kip + vardiya gerçekleri + şerit kararı. */
async function alarmShiftState(now: Date): Promise<AlarmShiftStatusDto> {
  const alarmEnabled = await resolveTezgahAlarmEnabled();
  const mode = await readTezgahAlarmNoShiftMode();
  const { shiftDefined, currentShift } = await loadAlarmShiftFacts(prisma, now);
  return {
    alarmEnabled, mode, shiftDefined, currentShift,
    notice: alarmShiftNotice({ alarmEnabled, mode, shiftDefined, shiftNow: currentShift !== null }),
    enableBlockedModes: TEZGAH_ALARM_NO_SHIFT_MODES.filter((m) => alarmEnableBlocked(m, shiftDefined)),
  };
}

/** Ayar ekranının vardiya durumu (`GET /api/feature-flags/tezgah-alarm-shift-status`). */
export async function getAlarmShiftStatus(now: Date = new Date()): Promise<ApiResponse<AlarmShiftStatusDto>> {
  return { success: true, data: await alarmShiftState(now) };
}

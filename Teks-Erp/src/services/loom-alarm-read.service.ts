// =============================================================================
// TeksERP — TEZGAH ALARMI · OKUMA (liste + özet şeridi + detay)
// =============================================================================
// Salt okuma; yazma yolları `loom-alarm.service`te. Liste, cursor ve özet şeridi TEK where'den
// doğar (`buildLoomAlarmWhere`) — şerit listenin süzgeciyle ayrışamaz. Detay alarm sayfasının
// (tasarım §A.7) bütün bloklarını tek uçtan verir; zaman çizgisi defterden, audit'ten değil.
// "Bana gelenler" (`mine`) ve "kime bildirildi" RAISED satırına DONMUŞ alıcıdan okunur (A4).
// =============================================================================
import {
  LoomAlarmEventKind, LoomAlarmRecipientMode, LoomAlarmRecipientSource, LoomAlarmState, type MachineDataSource, type MachineStopLossClass, type Prisma,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { buildNextCursor, cursorWhere, decodeCursor } from "../utils/cursor";
import { readFilterList, readIdCondition } from "../utils/query-parser";
import { resolveRangeEnd, resolveRangeStart } from "../constants/time";
import { readDbNow } from "./helpers/machine-run-open.helper";
import { ACTIVE_ALARM_STATES } from "./loom-alarm.service";

/** Kapsam — kapalı küme; tanınmayan değer route'ta 400 (fail-closed). */
export const LOOM_ALARM_SCOPES = ["active", "history", "all"] as const;
export type LoomAlarmScope = (typeof LOOM_ALARM_SCOPES)[number];

const CLOSED_ALARM_STATES: LoomAlarmState[] = [LoomAlarmState.RESOLVED, LoomAlarmState.CANCELLED];

export interface LoomAlarmListFilter {
  scope: LoomAlarmScope;
  machineId?: string | string[];
  stationId?: string | string[];
  reasonCode?: string | string[];
  tier?: 1 | 2;
  from?: string;
  to?: string;
  /** Bana gelenler: donmuş listede ben, ya da izne göre kipte K1 (K2 yalnız üst kademe yetkisiyle). */
  mine?: { userId: string; canEscalate: boolean };
}

/** "Bana gelenler" yüklemi — alarmın en az bir RAISED satırı beni hedefledi. */
export function mineAlarmWhere(m: { userId: string; canEscalate: boolean }): Prisma.LoomAlarmWhereInput {
  return {
    events: {
      some: {
        kind: LoomAlarmEventKind.RAISED,
        OR: [
          { recipientMode: LoomAlarmRecipientMode.LISTED, recipients: { some: { userId: m.userId } } },
          {
            OR: [{ recipientMode: LoomAlarmRecipientMode.BY_PERMISSION }, { recipientMode: null }],
            tier: m.canEscalate ? { in: [1, 2] } : 1,
          },
        ],
      },
    },
  };
}

/** Listenin, cursor'un ve özet şeridinin TEK where'i. */
export function buildLoomAlarmWhere(f: LoomAlarmListFilter): Prisma.LoomAlarmWhereInput {
  const and: Prisma.LoomAlarmWhereInput[] = [];
  if (f.scope === "active") and.push({ state: { in: ACTIVE_ALARM_STATES } });
  else if (f.scope === "history") and.push({ state: { in: CLOSED_ALARM_STATES } });
  const machine = readIdCondition(f.machineId);
  if (machine !== null) and.push({ machineId: machine });
  const station = readIdCondition(f.stationId);
  if (station !== null) and.push({ machine: { stationId: station } });
  const reasons = readFilterList(f.reasonCode);
  if (reasons.length > 0) and.push({ stopEvent: { reasonCode: { in: reasons } } });
  if (f.tier !== undefined) and.push({ tier: f.tier });
  if (f.from) and.push({ createdAt: { gte: resolveRangeStart(f.from) } });
  if (f.to) and.push({ createdAt: { lte: resolveRangeEnd(f.to) } });
  if (f.mine) and.push(mineAlarmWhere(f.mine));
  return and.length > 0 ? { AND: and } : {};
}

const LIST_SELECT = {
  id: true, kind: true, state: true, tier: true, targetMinutes: true, graceMinutes: true, k1DueAt: true, k2DueAt: true,
  ackedAt: true, snoozedUntil: true, closedAt: true, totalSec: true, overdueSec: true, cancelReason: true, createdAt: true,
  machine: { select: { id: true, code: true, name: true, station: { select: { id: true, name: true } } } },
  stopEvent: { select: { id: true, startedAt: true, endedAt: true, reasonCode: true, lossClass: true, source: true } },
  ackedBy: { select: { id: true, fullName: true } },
  snoozedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.LoomAlarmSelect;
type ListRow = Prisma.LoomAlarmGetPayload<{ select: typeof LIST_SELECT }>;

export interface LoomAlarmPersonDto { id: string; name: string }

export interface LoomAlarmItemDto {
  id: string;
  kind: string;
  state: LoomAlarmState;
  tier: number;
  machine: { id: string; code: string; name: string; hallId: string; hallName: string };
  stop: { id: string; startedAt: Date; endedAt: Date | null; reasonCode: string | null; reasonLabel: string | null; lossClass: MachineStopLossClass | null; source: MachineDataSource };
  targetMinutes: number | null;
  graceMinutes: number;
  k1DueAt: Date;
  k2DueAt: Date | null;
  ackedBy: LoomAlarmPersonDto | null;
  ackedAt: Date | null;
  snoozedBy: LoomAlarmPersonDto | null;
  snoozedUntil: Date | null;
  closedAt: Date | null;
  totalSec: number | null;
  overdueSec: number | null;
  cancelReason: string | null;
  createdAt: Date;
}

export interface LoomAlarmSummaryDto {
  total: number;
  open: number;
  acked: number;
  resolved: number;
  cancelled: number;
  /** Üst kademeye (K2) çıkmış alarm. */
  escalated: number;
}

async function reasonLabels(codes: Array<string | null>): Promise<Map<string, string>> {
  const uniq = [...new Set(codes.filter((c): c is string => c !== null))];
  if (uniq.length === 0) return new Map();
  const rows = await prisma.reasonPreset.findMany({ where: { kind: "MACHINE_STOP", code: { in: uniq } }, select: { code: true, label: true } });
  return new Map(rows.map((r) => [r.code, r.label]));
}

const person = (u: { id: string; fullName: string } | null): LoomAlarmPersonDto | null => (u ? { id: u.id, name: u.fullName } : null);

function itemDto(r: ListRow, labels: Map<string, string>): LoomAlarmItemDto {
  return {
    id: r.id, kind: r.kind, state: r.state, tier: r.tier,
    machine: { id: r.machine.id, code: r.machine.code, name: r.machine.name, hallId: r.machine.station.id, hallName: r.machine.station.name },
    stop: {
      id: r.stopEvent.id, startedAt: r.stopEvent.startedAt, endedAt: r.stopEvent.endedAt, reasonCode: r.stopEvent.reasonCode,
      reasonLabel: r.stopEvent.reasonCode ? (labels.get(r.stopEvent.reasonCode) ?? null) : null, lossClass: r.stopEvent.lossClass, source: r.stopEvent.source,
    },
    targetMinutes: r.targetMinutes, graceMinutes: r.graceMinutes, k1DueAt: r.k1DueAt, k2DueAt: r.k2DueAt,
    ackedBy: person(r.ackedBy), ackedAt: r.ackedAt, snoozedBy: person(r.snoozedBy), snoozedUntil: r.snoozedUntil,
    closedAt: r.closedAt, totalSec: r.totalSec, overdueSec: r.overdueSec, cancelReason: r.cancelReason, createdAt: r.createdAt,
  };
}

/** Özet şeridi — listeyle AYNI where (cursor hariç). */
export async function summarizeLoomAlarms(where: Prisma.LoomAlarmWhereInput): Promise<LoomAlarmSummaryDto> {
  const groups = await prisma.loomAlarm.groupBy({ by: ["state", "tier"], where, _count: { _all: true } });
  const s: LoomAlarmSummaryDto = { total: 0, open: 0, acked: 0, resolved: 0, cancelled: 0, escalated: 0 };
  for (const g of groups) {
    const n = g._count._all;
    s.total += n;
    if (g.state === LoomAlarmState.OPEN) s.open += n;
    else if (g.state === LoomAlarmState.ACKED) s.acked += n;
    else if (g.state === LoomAlarmState.RESOLVED) s.resolved += n;
    else if (g.state === LoomAlarmState.CANCELLED) s.cancelled += n;
    if (g.tier >= 2) s.escalated += n;
  }
  return s;
}

export interface LoomAlarmListResult {
  items: LoomAlarmItemDto[];
  nextCursor: string | null;
  summary: LoomAlarmSummaryDto;
}

/** Liste — en yeni önce (createdAt DESC, id DESC); cursor opak, bozuk cursor 400. */
export async function listLoomAlarms(f: LoomAlarmListFilter & { cursor?: string; limit?: number }): Promise<LoomAlarmListResult> {
  const where = buildLoomAlarmWhere(f);
  const limit = f.limit ?? 50;
  let page: Prisma.LoomAlarmWhereInput = where;
  if (f.cursor) {
    const c = decodeCursor(f.cursor);
    if (!c) throw AppError.badRequest("Geçersiz sayfa imleci", { code: "INVALID_CURSOR" });
    page = { AND: [where, cursorWhere(c)] };
  }
  const rows = await prisma.loomAlarm.findMany({ where: page, select: LIST_SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 });
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const labels = await reasonLabels(data.map((r) => r.stopEvent.reasonCode));
  return {
    items: data.map((r) => itemDto(r, labels)),
    nextCursor: hasMore ? buildNextCursor(data[data.length - 1]) : null,
    summary: await summarizeLoomAlarms(where),
  };
}

// ── DETAY (alarm sayfası, §A.7) ──────────────────────────────────────────────
export interface LoomAlarmTimelineEntryDto {
  id: string;
  kind: LoomAlarmEventKind;
  at: Date;
  tier: number | null;
  user: LoomAlarmPersonDto | null;
  snoozedUntil: Date | null;
  note: string | null;
  code: string | null;
  retractsEventId: string | null;
  /** Yalnız NOTE: sonradan geri çekildi mi (not silinmez; ekran üstünü çizer). */
  retracted: boolean;
  /** Yalnız RAISED: donmuş alıcı kipi (A4 öncesi satır = BY_PERMISSION); diğer satırlarda null. */
  recipientMode: LoomAlarmRecipientMode | null;
  /** Yalnız RAISED: donmuş alıcılar (BY_PERMISSION'da boş); diğer satırlarda null. */
  recipients: LoomAlarmRecipientDto[] | null;
}

export interface LoomAlarmRecipientDto { id: string; name: string; source: LoomAlarmRecipientSource }

/** Kime bildirildi — kademe başına bir girdi, RAISED sırasıyla. */
export interface LoomAlarmNotificationDto {
  tier: number;
  at: Date;
  mode: LoomAlarmRecipientMode;
  recipients: LoomAlarmRecipientDto[];
}

export interface LoomAlarmStopStatDto { count: number; closedCount: number; totalSec: number; avgSec: number | null }

export interface LoomAlarmDetailDto {
  alarm: LoomAlarmItemDto;
  /** Beklenen sonraki adım: canlı alarmda henüz çalmamış üst kademenin vadesi. */
  nextDueAt: Date | null;
  timeline: LoomAlarmTimelineEntryDto[];
  notifications: LoomAlarmNotificationDto[];
  context: { job: { weavingOrderNumber: string; itemName: string; colorName: string | null } | null };
  /** Bu tezgahta bu sebeple son 7/30 gün + aynı sebebin bütün salondaki 30 günlük sıklığı. Sebepsiz duruşta null. */
  similar: { reasonCode: string; machine7d: LoomAlarmStopStatDto; machine30d: LoomAlarmStopStatDto; floor30d: LoomAlarmStopStatDto } | null;
  recentStops: Array<{ id: string; startedAt: Date; endedAt: Date | null; durationSec: number | null; reasonCode: string | null; reasonLabel: string | null; lossClass: MachineStopLossClass | null }>;
}

const SOURCE_RANK: Record<LoomAlarmRecipientSource, number> = { DUTY_OVERRIDE: 0, HALL_SHIFT: 1, USER: 2, PERMISSION: 3 };

/** Donmuş alıcılar kaynak sırasıyla (nöbet → sorumlu → kişi → yetki), sonra ada göre. */
function sortRecipients(rows: Array<{ source: LoomAlarmRecipientSource; user: { id: string; fullName: string } }>): LoomAlarmRecipientDto[] {
  return rows
    .map((r) => ({ id: r.user.id, name: r.user.fullName, source: r.source }))
    .sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || a.name.localeCompare(b.name, "tr") || a.id.localeCompare(b.id));
}

export const LOOM_ALARM_RECENT_STOPS = 5;
const DAY_MS = 86_400_000;

async function stopStat(where: Prisma.MachineStopEventWhereInput): Promise<LoomAlarmStopStatDto> {
  const all = await prisma.machineStopEvent.count({ where });
  const closed = await prisma.machineStopEvent.aggregate({ where: { ...where, durationSec: { not: null } }, _count: { _all: true }, _sum: { durationSec: true } });
  const closedCount = closed._count._all;
  const totalSec = closed._sum.durationSec ?? 0;
  return { count: all, closedCount, totalSec, avgSec: closedCount > 0 ? Math.round(totalSec / closedCount) : null };
}

export async function getLoomAlarmDetail(id: string): Promise<LoomAlarmDetailDto> {
  const row = await prisma.loomAlarm.findUnique({ where: { id }, select: { ...LIST_SELECT, machineId: true } });
  if (!row) throw AppError.notFound("Alarm bulunamadı", { code: "LOOM_ALARM_NOT_FOUND" });
  const events = await prisma.loomAlarmEvent.findMany({
    where: { alarmId: id },
    select: {
      id: true, kind: true, tier: true, createdAt: true, snoozedUntil: true, note: true, code: true, retractsEventId: true, recipientMode: true,
      user: { select: { id: true, fullName: true } }, retractedBy: { select: { id: true } },
      recipients: { select: { source: true, user: { select: { id: true, fullName: true } } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const now = await readDbNow();
  const stopBase: Prisma.MachineStopEventWhereInput = { revokedAt: null };
  const reasonCode = row.stopEvent.reasonCode;
  const similar = reasonCode === null ? null : {
    reasonCode,
    machine7d: await stopStat({ ...stopBase, machineId: row.machineId, reasonCode, startedAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } }),
    machine30d: await stopStat({ ...stopBase, machineId: row.machineId, reasonCode, startedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } }),
    floor30d: await stopStat({ ...stopBase, reasonCode, startedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } }),
  };
  const recent = await prisma.machineStopEvent.findMany({
    where: { ...stopBase, machineId: row.machineId },
    select: { id: true, startedAt: true, endedAt: true, durationSec: true, reasonCode: true, lossClass: true },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: LOOM_ALARM_RECENT_STOPS,
  });
  const run = await prisma.machineRun.findFirst({
    where: { machineId: row.machineId, endedAt: null, revokedAt: null, weavingOrderId: { not: null } },
    select: { weavingOrder: { select: { weavingOrderNumber: true, item: { select: { name: true } }, color: { select: { name: true } } } } },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
  });
  const labels = await reasonLabels([reasonCode, ...recent.map((s) => s.reasonCode)]);
  const alarm = itemDto(row, labels);
  const live = ACTIVE_ALARM_STATES.includes(row.state);
  const timeline: LoomAlarmTimelineEntryDto[] = events.map((e) => {
    const raised = e.kind === LoomAlarmEventKind.RAISED;
    return {
      id: e.id, kind: e.kind, at: e.createdAt, tier: e.tier, user: person(e.user), snoozedUntil: e.snoozedUntil, note: e.note, code: e.code,
      retractsEventId: e.retractsEventId, retracted: e.retractedBy !== null,
      recipientMode: raised ? (e.recipientMode ?? LoomAlarmRecipientMode.BY_PERMISSION) : null,
      recipients: raised ? sortRecipients(e.recipients) : null,
    };
  });
  return {
    alarm,
    nextDueAt: live && row.tier < 2 ? row.k2DueAt : null,
    timeline,
    notifications: timeline
      .filter((t) => t.kind === LoomAlarmEventKind.RAISED)
      .map((t) => ({ tier: t.tier ?? 0, at: t.at, mode: t.recipientMode!, recipients: t.recipients ?? [] })),
    context: {
      job: run?.weavingOrder
        ? { weavingOrderNumber: run.weavingOrder.weavingOrderNumber, itemName: run.weavingOrder.item.name, colorName: run.weavingOrder.color?.name ?? null }
        : null,
    },
    similar,
    recentStops: recent.map((s) => ({ ...s, reasonLabel: s.reasonCode ? (labels.get(s.reasonCode) ?? null) : null })),
  };
}

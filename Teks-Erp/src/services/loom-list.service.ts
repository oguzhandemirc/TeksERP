// =============================================================================
// TeksERP — TEZGAH LİSTELERİ (okuma): açık koşumlar · günün indirmeleri · bağlanmamış indirmeler
// =============================================================================
// Tablet tezgah ekranının ve KK1'in "hangi indirmeden?" açık liste seçiminin
// BACKEND ÖN KOŞULU (DOKUMA-IS-EMRI §3.9 J.2: liste uçları backend'de, ilk dilim
// yerel durumla YAPILMAZ). Üç soru, üç yüklem — hepsi SUNUCUDA süzülür:
//   • AÇIK KOŞUM  — `endedAt IS NULL ∧ revokedAt IS NULL`, makine başına, hat sırasıyla.
//   • GÜNÜN İNDİRMELERİ — `doffedAt` FABRİKA günü içinde (Europe/Istanbul,
//     `src/constants/time.ts`; çıplak DATE_TRUNC yok), makine başına; geri alınmış
//     satır KAPSAM DIŞI (rapor süzer, guard süzmez — machineRunCount ayrımı).
//   • BAĞLANMAMIŞ İNDİRMELER — hiç top doğurmamış (`rolls: none`), geri alınmamış,
//     son N günün doff'ları; makine OPSİYONEL (masa KK1 her tezgahın indirmesini
//     görür — bağ açık liste seçimidir, 1e hükmü (a)).
//
// ⚠️ Liste + SAYI aynı where'den doğar (`warehouse-stock.helper` emsali: liste
// kırpılır, SAYI kırpılmaz): `take` tavanı aşılırsa `truncated: true` + `total`.
// Yazma YOK — bu dosya deftere dokunmaz.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { MACHINE_STOP_SELECT, type MachineStopDto } from "./helpers/machine-stop-context.helper";
import { AppError } from "../utils/app-error";
import { factoryDayEnd, factoryDayStart, resolveRangeEnd, resolveRangeStart } from "../constants/time";
import { MACHINE_RUN_SELECT, type MachineRunDto } from "./machine-run.service";
import { DOFF_SELECT, type DoffEventDto } from "./machine-doff.service";
import type { ApiResponse } from "../types/api.types";

/** Liste tavanı — bir tezgahın günlük indirmesi onlarcadır; tavan sayıyı DEĞİL listeyi kırpar. */
export const LOOM_LIST_TAKE = 200;
/** Bağlanmamış indirme penceresi (gün) — varsayılan ve tavan. */
export const UNLINKED_DEFAULT_DAYS = 3;
export const UNLINKED_MAX_DAYS = 30;

export interface LoomListMeta {
  total: number;
  truncated: boolean;
}

async function assertMachineExists(machineId: string): Promise<void> {
  const m = await prisma.machine.findUnique({ where: { id: machineId }, select: { id: true } });
  if (!m) throw AppError.notFound("Makine bulunamadı", { machineId });
}

/** Makinenin AÇIK koşumları (hat başına en çok bir; sed bunu zaten zorlar). */
export async function listOpenMachineRuns(machineId: string): Promise<ApiResponse<MachineRunDto[]> & { meta: LoomListMeta }> {
  await assertMachineExists(machineId);
  const where: Prisma.MachineRunWhereInput = { machineId, endedAt: null, revokedAt: null };
  const rows = await prisma.machineRun.findMany({ where, select: MACHINE_RUN_SELECT, orderBy: { productionLineNo: "asc" }, take: LOOM_LIST_TAKE });
  const total = await prisma.machineRun.count({ where });
  return { success: true, data: rows, meta: { total, truncated: total > rows.length } };
}

export type DoffListRow = DoffEventDto & { rollCount: number };

function withRollCount(rows: Array<DoffEventDto & { _count: { rolls: number } }>): DoffListRow[] {
  return rows.map(({ _count, ...r }) => ({ ...r, rollCount: _count.rolls }));
}

/**
 * Makinenin bir FABRİKA günündeki indirmeleri. `date` (YYYY-MM-DD) verilmezse bugün;
 * gün sınırları Europe/Istanbul'dan mutlak ana çevrilir (DST güvenli).
 */
export async function listDoffsForDay(args: { machineId: string; date?: string | null }): Promise<ApiResponse<DoffListRow[]> & { meta: LoomListMeta & { dayStart: Date; dayEnd: Date } }> {
  await assertMachineExists(args.machineId);
  const dayStart = args.date ? resolveRangeStart(args.date) : factoryDayStart();
  const dayEnd = args.date ? resolveRangeEnd(args.date) : factoryDayEnd();
  const where: Prisma.DoffEventWhereInput = { machineId: args.machineId, revokedAt: null, doffedAt: { gte: dayStart, lte: dayEnd } };
  const rows = await prisma.doffEvent.findMany({
    where,
    select: { ...DOFF_SELECT, _count: { select: { rolls: true } } },
    orderBy: [{ doffedAt: "desc" }, { createdAt: "desc" }],
    take: LOOM_LIST_TAKE,
  });
  const total = await prisma.doffEvent.count({ where });
  return { success: true, data: withRollCount(rows), meta: { total, truncated: total > rows.length, dayStart, dayEnd } };
}

/**
 * Hiç top doğurmamış, geri alınmamış indirmeler — KK1'in seçim listesi. Pencere son
 * `sinceDays` fabrika günü (varsayılan 3, tavan 30); makine verilirse daraltılır.
 */
export async function listUnlinkedDoffs(args: { machineId?: string | null; sinceDays?: number | null }): Promise<ApiResponse<DoffListRow[]> & { meta: LoomListMeta & { since: Date } }> {
  if (args.machineId) await assertMachineExists(args.machineId);
  const days = Math.min(Math.max(args.sinceDays ?? UNLINKED_DEFAULT_DAYS, 1), UNLINKED_MAX_DAYS);
  // (days-1) gün önceki anın FABRİKA gün başı — DST'de duvar saatinden değil fabrika parçalarından çözülür.
  const since = factoryDayStart(new Date(Date.now() - (days - 1) * 24 * 3600_000));
  const where: Prisma.DoffEventWhereInput = {
    ...(args.machineId ? { machineId: args.machineId } : {}),
    revokedAt: null,
    rolls: { none: {} },
    doffedAt: { gte: since },
  };
  const rows = await prisma.doffEvent.findMany({
    where,
    select: { ...DOFF_SELECT, _count: { select: { rolls: true } } },
    orderBy: [{ doffedAt: "desc" }, { createdAt: "desc" }],
    take: LOOM_LIST_TAKE,
  });
  const total = await prisma.doffEvent.count({ where });
  return { success: true, data: withRollCount(rows), meta: { total, truncated: total > rows.length, since } };
}

// ─────────────────────────────────────────────────────────────────────────────
// LİSTE — açık duruşlar + sınıflandırma kuyruğu (boğaz-ikizi: `requiresReason ∧ reasonCode IS NULL`)
// ─────────────────────────────────────────────────────────────────────────────
export const CLASSIFICATION_QUEUE_WHERE = { requiresReason: true, reasonCode: null, revokedAt: null } satisfies Prisma.MachineStopEventWhereInput;

export async function listMachineStops(params: { machineId?: string; openOnly?: boolean; queueOnly?: boolean; limit?: number }): Promise<ApiResponse<MachineStopDto[]>> {
  const where: Prisma.MachineStopEventWhereInput = {
    revokedAt: null,
    ...(params.machineId ? { machineId: params.machineId } : {}),
    ...(params.openOnly ? { endedAt: null } : {}),
    ...(params.queueOnly ? CLASSIFICATION_QUEUE_WHERE : {}),
  };
  const rows = await prisma.machineStopEvent.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: Math.min(Math.max(params.limit ?? 100, 1), 500),
    select: MACHINE_STOP_SELECT,
  });
  return { success: true, data: rows };
}

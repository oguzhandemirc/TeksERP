// =============================================================================
// TeksERP — TEZGAH DURUŞU · WATCHDOG DÜZELTMESİ (D4) — `closeStopCore`un yardımcısı
// =============================================================================
// Yalnız `machine-stop.service::closeStopCore` çağırır (tek boğaz; test_makine_durus_bogazi §7b2
// düzeltme UPDATE'inin TEK yerini bu dosya sayar). Dosya ayrı: servis satır tavanını aşmasın.
// =============================================================================
import { MachineStopEndSource, type Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";

const TABLE = "MACHINE_STOP_EVENT";

export const STOP_CORRECTED_MESSAGE = "Geçici (watchdog) kapanış gerçek bitişle düzeltildi";

export interface WatchdogCorrection {
  tx: Prisma.TransactionClient;
  stopId: string;
  /** Kapanış claim'i tutmayınca okunan satır (`closeStopCore`). */
  fresh: { machineId: string; startedAt: Date; endedAt: Date | null; endSource: MachineStopEndSource | null; endCorrectedAt: Date | null };
  closer: { endSource: MachineStopEndSource };
  endedAt: Date;
  simdi: Date;
}

/** `closeStopCore` tx'inin hatası: kartın bitişi mühüre çarptıysa kuyruğa yazılır, aksi hâlde hata aynen. */
export async function rethrowSealedSignalEnd(e: unknown, stopId: string, endedAt: Date, endSource: MachineStopEndSource): Promise<never> {
  const sealed = endSource === MachineStopEndSource.SIGNAL && e instanceof AppError && (e.details as { code?: string } | undefined)?.code === "SHIFT_SEALED";
  throw sealed ? await queueLateEnd(stopId, endedAt, e) : e;
}

/** Düzeltmenin ayak izi (tx DIŞINDA, best-effort). */
export async function auditWatchdogCorrection(closed: { id: string; endedAt: Date | null; endSource: MachineStopEndSource | null; endCorrectedAt: Date | null }, old: Date | null | undefined): Promise<void> {
  await AuditService.log({
    userId: undefined, action: "UPDATE", tableName: TABLE, recordId: closed.id,
    changes: [
      { field: "endedAt", old: old ?? null, new: closed.endedAt },
      { field: "endSource", old: MachineStopEndSource.WATCHDOG, new: closed.endSource },
      { field: "endCorrectedAt", old: null, new: closed.endCorrectedAt },
    ],
  }).catch(() => undefined);
}

/** Mühürlü vardiyadaki WATCHDOG kapanışına gelen gerçek bitiş kaybolmasın: ilk değer kuyruğa yazılır, 409 korunur. */
async function queueLateEnd(stopId: string, endedAt: Date, sealed: AppError): Promise<AppError> {
  const q = await prisma.machineStopEvent.updateMany({
    where: { id: stopId, endSource: MachineStopEndSource.WATCHDOG, endCorrectedAt: null, lateEndedAt: null, revokedAt: null },
    data: { lateEndedAt: endedAt },
  });
  if (q.count === 0) return sealed;
  await AuditService.log({
    userId: undefined, action: "UPDATE", tableName: TABLE, recordId: stopId, changes: [{ field: "lateEndedAt", old: null, new: endedAt }],
  }).catch(() => undefined);
  const details = (sealed.details ?? {}) as Record<string, unknown>;
  return AppError.conflict(`${sealed.message} Gerçek bitiş "geciken kapanışlar" kuyruğuna alındı; mühür açılınca uygulanır.`, { ...details, lateEndQueued: true });
}

/**
 * WATCHDOG DÜZELTMESİ — tahmin bir çelişki değil düzeltmedir: claim `endSource = WATCHDOG ∧ endCorrectedAt IS NULL`
 * TEK KEZ uygulanır; `provisionalEndedAt` İZ olarak kalır. Uzatılan bitiş sonraki duruşa taşamaz (409 STOP_OVERLAP).
 * `false` = düzeltme konusu değil (insan/sinyal kapanışı ya da düzeltilmiş) — çağıran olağan çatışma yoluna devam eder.
 */
export async function correctWatchdogCloseTx(input: WatchdogCorrection): Promise<boolean> {
  const { tx, stopId, fresh: f, closer, endedAt, simdi } = input;
  if (!f.endedAt || closer.endSource !== MachineStopEndSource.SIGNAL || f.endSource !== MachineStopEndSource.WATCHDOG || f.endCorrectedAt) return false;
  const fresh = { machineId: f.machineId, startedAt: f.startedAt, endedAt: f.endedAt };
  if (fresh.startedAt > endedAt) {
    throw AppError.badRequest("Bitiş zamanı başlangıçtan önce olamaz.", { code: "STOP_END_BEFORE_START", startedAt: fresh.startedAt, endedAt });
  }
  if (endedAt > fresh.endedAt) {
    const next = await tx.machineStopEvent.findFirst({
      where: { machineId: fresh.machineId, revokedAt: null, id: { not: stopId }, startedAt: { gt: fresh.startedAt, lt: endedAt } },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }], select: { id: true, startedAt: true },
    });
    if (next) {
      throw AppError.conflict("Gerçek bitiş, tezgahta sonradan açılmış bir duruşla çakışıyor — geçici kapanış korunuyor.", {
        code: "STOP_OVERLAP", stopId, conflictingStopId: next.id, startedAt: next.startedAt, endedAt,
      });
    }
  }
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE machine_stop_events
       SET "endedAt" = ${endedAt}, "endSource" = 'SIGNAL'::"MachineStopEndSource", "endCorrectedAt" = ${simdi}::timestamptz,
           "durationSec" = GREATEST(0, EXTRACT(EPOCH FROM (${endedAt}::timestamptz - "startedAt")))::int,
           "updatedAt" = ${simdi}::timestamptz
     WHERE id = ${stopId}::uuid AND "endSource" = 'WATCHDOG'::"MachineStopEndSource" AND "endCorrectedAt" IS NULL
       AND "revokedAt" IS NULL AND "startedAt" <= ${endedAt}::timestamptz
     RETURNING id`;
  if (rows.length === 0) throw AppError.conflict("Duruş az önce değişti — tekrar deneyin.", { code: "MACHINE_STOP_RACE", stopId });
  return true;
}

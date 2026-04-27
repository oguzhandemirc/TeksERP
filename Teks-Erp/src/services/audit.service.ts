// =============================================================================
// TeksERP - Audit (SystemLog) Service
// =============================================================================
// Every CUD operation MUST log via this service (core-architecture.md rule).
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";

type JsonValue = Prisma.InputJsonValue | typeof Prisma.JsonNull;

const ARCHIVE_BATCH_SIZE = 5000;

export class AuditService {
  /**
   * Log a Create/Update/Delete operation to SystemLog.
   */
  static async log(params: {
    userId: string | undefined;
    action: "CREATE" | "UPDATE" | "DELETE";
    tableName: string;
    recordId: string;
    oldData?: Record<string, unknown> | null;
    newData?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      await prisma.systemLog.create({
        data: {
          userId: params.userId ?? null,
          action: params.action,
          tableName: params.tableName,
          recordId: params.recordId,
          oldData: (params.oldData ?? Prisma.JsonNull) as JsonValue,
          newData: (params.newData ?? Prisma.JsonNull) as JsonValue,
        },
      });
    } catch (error) {
      // Audit logging should never crash the main operation
      console.error("[audit]: Failed to write SystemLog:", error);
    }
  }

  /**
   * X aydan eski sistem loglarını system_log_archives tablosuna taşır.
   * Büyük tablolarda ARCHIVE_BATCH_SIZE kadar kayıtla çalışır — tekrar çağır.
   * Dönen `archived` sayısı 0 ise tamamlandı.
   */
  static async archiveOlderThan(monthsToKeep: number): Promise<{ archived: number; cutoff: string }> {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - monthsToKeep);

    const logsToArchive = await prisma.systemLog.findMany({
      where: { createdAt: { lt: cutoff } },
      take: ARCHIVE_BATCH_SIZE,
      orderBy: { createdAt: "asc" },
    });

    if (logsToArchive.length === 0) {
      return { archived: 0, cutoff: cutoff.toISOString() };
    }

    const ids = logsToArchive.map((l) => l.id);

    await prisma.$transaction(async (tx) => {
      await tx.systemLogArchive.createMany({
        data: logsToArchive.map((log) => ({
          id: log.id,
          userId: log.userId,
          action: log.action,
          tableName: log.tableName,
          recordId: log.recordId,
          oldData: log.oldData as Prisma.InputJsonValue,
          newData: log.newData as Prisma.InputJsonValue,
          createdAt: log.createdAt,
          updatedAt: log.updatedAt,
        })),
        skipDuplicates: true,
      });
      await tx.systemLog.deleteMany({ where: { id: { in: ids } } });
    });

    return { archived: logsToArchive.length, cutoff: cutoff.toISOString() };
  }
}

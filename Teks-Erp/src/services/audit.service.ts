// =============================================================================
// TeksERP - Audit (SystemLog) Service
// =============================================================================
// Every CUD operation MUST log via this service (core-architecture.md rule).
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";

type JsonValue = Prisma.InputJsonValue | typeof Prisma.JsonNull;

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
}

// =============================================================================
// TeksERP - Order Service (extends BaseService)
// =============================================================================
// Overrides:
//   - create: auto-generates orderNumber as YYYYMMDD-N
//   - softDelete: sets status = CANCELLED (Order has no isActive field)
//                 + iş emri bağlarını güvenli şekilde çözer (R1)
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { BaseService, BaseServiceConfig } from "./base.service";
import { ApiResponse } from "../types/api.types";
import { AppError } from "../utils/app-error";

export class OrderService extends BaseService {
  constructor(config: BaseServiceConfig) {
    super(config);
  }

  async create(
    data: Record<string, unknown>,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const today = new Date();
    const prefix =
      today.getFullYear().toString() +
      String(today.getMonth() + 1).padStart(2, "0") +
      String(today.getDate()).padStart(2, "0");

    const lastOrder = await prisma.order.findFirst({
      where: { orderNumber: { startsWith: prefix } },
      orderBy: { orderNumber: "desc" },
    });

    const seq = lastOrder
      ? parseInt(lastOrder.orderNumber.split("-")[1], 10) + 1
      : 1;

    const orderNumber = `${prefix}-${seq}`;

    const prismaData: Record<string, unknown> = {
      ...data,
      orderNumber,
    };

    if (this.config.nestedCreateFields) {
      for (const field of this.config.nestedCreateFields) {
        if (Array.isArray(prismaData[field])) {
          prismaData[field] = { create: prismaData[field] };
        }
      }
    }

    const record = (await this.delegate.create({
      data: prismaData,
      ...(this.config.defaultInclude
        ? { include: this.config.defaultInclude }
        : {}),
    })) as Record<string, unknown>;

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: this.config.tableName,
      recordId: record.id as string,
      newData: { ...data, orderNumber },
    });

    return { success: true, data: record, message: "Sipariş oluşturuldu" };
  }

  /**
   * Soft-delete (cancel) an order.
   *
   * Business Rules (R1 — sipariş iptal çift yönlü tutarlılık):
   *   - Sipariş hiçbir WO'ya bağlı değilse sorunsuz iptal.
   *   - PLANNED durumdaki WO bağları varsa → join satırlarını otomatik kopar
   *     (WO hayatta kalır, operatör isterse STOCK_PRODUCTION'a çevirir).
   *   - IN_PROGRESS / PAUSED / COMPLETED durumda WO varsa → 409 conflict.
   *     Operatör önce o WO'yu iptal etmeli.
   */
  async softDelete(
    id: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const oldRecord = await prisma.order.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            workOrderLinks: {
              include: { workOrder: true },
            },
          },
        },
      },
    });

    if (!oldRecord) {
      return { success: false, data: null, message: "Sipariş bulunamadı" };
    }

    const allLinks = oldRecord.lines.flatMap((line) => line.workOrderLinks);
    const blockingStatuses = new Set(["IN_PROGRESS", "PAUSED", "COMPLETED"]);
    const blockingWOs = allLinks
      .map((l) => l.workOrder)
      .filter((wo) => blockingStatuses.has(wo.status));

    if (blockingWOs.length > 0) {
      const batchNumbers = [...new Set(blockingWOs.map((w) => w.batchNumber))].join(", ");
      throw AppError.conflict(
        `Bu siparişe bağlı aktif/tamamlanmış iş emirleri var: ${batchNumbers}. Önce onları iptal edin.`
      );
    }

    const plannedLinkIds = allLinks
      .filter((l) => l.workOrder.status === "PLANNED")
      .map((l) => ({ workOrderId: l.workOrderId, orderLineId: l.orderLineId }));

    const updated = await prisma.$transaction(async (tx) => {
      if (plannedLinkIds.length > 0) {
        await tx.workOrderToOrderLine.deleteMany({
          where: {
            OR: plannedLinkIds.map((k) => ({
              workOrderId: k.workOrderId,
              orderLineId: k.orderLineId,
            })),
          },
        });
      }

      return tx.order.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: oldRecord as unknown as Record<string, unknown>,
      newData: {
        status: "CANCELLED",
        unlinkedWorkOrderCount: plannedLinkIds.length,
      },
    });

    return {
      success: true,
      data: updated,
      message:
        plannedLinkIds.length > 0
          ? `Sipariş iptal edildi. ${plannedLinkIds.length} planlı iş emri bağlantısı koparıldı.`
          : "Sipariş iptal edildi",
    };
  }
}

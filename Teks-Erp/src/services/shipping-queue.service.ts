// =============================================================================
// TeksERP - Shipping Queue Service (sipariş seviyesinde)
// =============================================================================
// Planlamacı bir siparişi sevkiyat akışına alır → saha personeli (tablet)
// kuyruktan siparişi alır, depodan kumaşları tarayıp çuvallara koyar, tartar
// ve sevkiyata gönderir. Otomatik eşleştirme yok — operatör her şeyi kendisi
// tarar. Bir sipariş aynı anda yalnız bir kez kuyrukta olabilir.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import {
  OrderStatus,
  Prisma,
  RollStatus,
  ShippingQueueStatus,
} from "@prisma/client";

const TABLE = "shipping_queue";

interface EnqueueInput {
  orderId: string;
  isUrgent?: boolean;
  note?: string | null;
}

interface ReorderItem {
  id: string;
  priority: number;
}

const QUEUE_INCLUDE = {
  order: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      orderDate: true,
      deadline: true,
      currency: true,
      totalAmount: true,
      customerId: true,
      customer: { select: { id: true, code: true, name: true } },
      branch: {
        select: { id: true, name: true, city: true, district: true },
      },
      lines: {
        select: {
          id: true,
          quantity: true,
          width: true,
          item: {
            select: {
              id: true,
              code: true,
              name: true,
              color: { select: { id: true, code: true, name: true, hex: true } },
            },
          },
          variant: { select: { id: true, code: true, name: true } },
          allocations: {
            select: {
              id: true,
              allocatedQty: true,
              roll: {
                select: { id: true, barcode: true, status: true, sackId: true },
              },
            },
          },
        },
      },
    },
  },
  addedBy: { select: { id: true, fullName: true } },
  assignedOperator: { select: { id: true, fullName: true } },
} satisfies Prisma.ShippingQueueInclude;

type QueueRowWithIncludes = Prisma.ShippingQueueGetPayload<{
  include: typeof QUEUE_INCLUDE;
}>;

function shapeQueueRow(q: QueueRowWithIncludes) {
  const lines = q.order.lines.map((line) => {
    const allocatedQty = line.allocations.reduce(
      (s, a) => s + a.allocatedQty,
      0,
    );
    return {
      lineId: line.id,
      itemId: line.item.id,
      itemCode: line.item.code,
      itemName: line.item.name,
      color: line.item.color,
      variant: line.variant,
      width: line.width,
      requestedQty: line.quantity,
      allocatedQty,
      remainingQty: Math.max(0, line.quantity - allocatedQty),
      allocations: line.allocations.map((a) => ({
        rollId: a.roll.id,
        barcode: a.roll.barcode,
        rollStatus: a.roll.status,
        sackId: a.roll.sackId,
        allocatedQty: a.allocatedQty,
      })),
    };
  });

  const totalRequested = lines.reduce((s, l) => s + l.requestedQty, 0);
  const totalAllocated = lines.reduce((s, l) => s + l.allocatedQty, 0);

  return {
    id: q.id,
    orderId: q.orderId,
    priority: q.priority,
    isUrgent: q.isUrgent,
    urgentMarkedAt: q.urgentMarkedAt,
    status: q.status,
    note: q.note,
    addedBy: q.addedBy,
    assignedOperator: q.assignedOperator,
    takenAt: q.takenAt,
    completedAt: q.completedAt,
    cancelledAt: q.cancelledAt,
    cancelReason: q.cancelReason,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
    order: {
      id: q.order.id,
      orderNumber: q.order.orderNumber,
      status: q.order.status,
      orderDate: q.order.orderDate,
      deadline: q.order.deadline,
      currency: q.order.currency,
      totalAmount: q.order.totalAmount ? String(q.order.totalAmount) : null,
      customer: q.order.customer,
      branch: q.order.branch,
      lines,
      totalRequestedQty: totalRequested,
      totalAllocatedQty: totalAllocated,
      remainingQty: Math.max(0, totalRequested - totalAllocated),
    },
  };
}

export class ShippingQueueService {
  /**
   * Liste — default aktif kayıtlar (WAITING + TAKEN). Filtreler: status, operator.
   */
  async list(params: {
    status?: ShippingQueueStatus | "ALL";
    operatorId?: string;
  }): Promise<ApiResponse<ReturnType<typeof shapeQueueRow>[]>> {
    const where: Prisma.ShippingQueueWhereInput =
      params.status === "ALL"
        ? {}
        : params.status
          ? { status: params.status }
          : {
              status: {
                in: [ShippingQueueStatus.WAITING, ShippingQueueStatus.TAKEN],
              },
            };

    if (params.operatorId) where.assignedOperatorId = params.operatorId;

    const items = await prisma.shippingQueue.findMany({
      where,
      orderBy: [
        { isUrgent: "desc" },
        { urgentMarkedAt: { sort: "asc", nulls: "last" } },
        { priority: "asc" },
        { createdAt: "asc" },
      ],
      include: QUEUE_INCLUDE,
    });

    return { success: true, data: items.map(shapeQueueRow) };
  }

  /**
   * Siparişi kuyruğa al. Onaysız/iptal/tamamlandı siparişler reddedilir.
   */
  async enqueue(
    input: EnqueueInput,
    userId: string | undefined,
  ): Promise<ApiResponse<ReturnType<typeof shapeQueueRow>>> {
    if (!userId) throw AppError.unauthorized();

    const order = await prisma.order.findUnique({
      where: { id: input.orderId },
      select: { id: true, orderNumber: true, status: true },
    });
    if (!order) throw AppError.notFound("Sipariş bulunamadı");
    if (order.status === OrderStatus.PENDING) {
      throw AppError.badRequest("Onaysız sipariş kuyruğa alınamaz");
    }
    if (
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.CANCELLED
    ) {
      throw AppError.badRequest(
        "Tamamlanmış veya iptal edilmiş sipariş kuyruğa alınamaz",
      );
    }

    const existing = await prisma.shippingQueue.findUnique({
      where: { orderId: input.orderId },
      select: { id: true, status: true },
    });
    if (existing) {
      if (
        existing.status === ShippingQueueStatus.WAITING ||
        existing.status === ShippingQueueStatus.TAKEN
      ) {
        throw AppError.conflict("Sipariş zaten kuyrukta");
      }
      // DONE/CANCELLED ise yeniden başlatmak için silip yeniden oluştur
      await prisma.shippingQueue.delete({ where: { id: existing.id } });
    }

    const last = await prisma.shippingQueue.aggregate({
      where: { status: ShippingQueueStatus.WAITING },
      _max: { priority: true },
    });
    const priority = (last._max.priority ?? -1) + 1;

    const created = await prisma.shippingQueue.create({
      data: {
        orderId: input.orderId,
        priority,
        isUrgent: input.isUrgent ?? false,
        urgentMarkedAt: input.isUrgent ? new Date() : null,
        note: input.note ?? null,
        addedByUserId: userId,
      },
      include: QUEUE_INCLUDE,
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: TABLE,
      recordId: created.id,
      newData: {
        orderId: input.orderId,
        orderNumber: order.orderNumber,
        isUrgent: created.isUrgent,
      },
    });

    return {
      success: true,
      data: shapeQueueRow(created),
      message: `${order.orderNumber} sevkiyat kuyruğuna alındı`,
    };
  }

  /**
   * Acil işaretle/kaldır.
   */
  async setUrgent(
    id: string,
    isUrgent: boolean,
    userId: string | undefined,
  ): Promise<ApiResponse<ReturnType<typeof shapeQueueRow>>> {
    const existing = await prisma.shippingQueue.findUnique({
      where: { id },
      select: { id: true, isUrgent: true, status: true },
    });
    if (!existing) throw AppError.notFound("Kuyruk kaydı bulunamadı");
    if (
      existing.status !== ShippingQueueStatus.WAITING &&
      existing.status !== ShippingQueueStatus.TAKEN
    ) {
      throw AppError.badRequest(
        "Sadece aktif (bekleyen/alınan) kayıtlar acil yapılabilir",
      );
    }

    const updated = await prisma.shippingQueue.update({
      where: { id },
      data: {
        isUrgent,
        urgentMarkedAt: isUrgent ? new Date() : null,
      },
      include: QUEUE_INCLUDE,
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: id,
      oldData: { isUrgent: existing.isUrgent },
      newData: { isUrgent: updated.isUrgent },
    });

    return { success: true, data: shapeQueueRow(updated) };
  }

  /**
   * Kuyruk sırasını güncelle. Sadece WAITING + non-urgent kayıtların priority'si
   * değiştirilebilir; acil kayıtlar listede zaten tepede tutulur.
   */
  async reorder(
    items: ReorderItem[],
    userId: string | undefined,
  ): Promise<ApiResponse<{ updated: number }>> {
    if (!userId) throw AppError.unauthorized();
    if (items.length === 0) return { success: true, data: { updated: 0 } };

    const existing = await prisma.shippingQueue.findMany({
      where: { id: { in: items.map((i) => i.id) } },
      select: { id: true, status: true, isUrgent: true },
    });
    const editable = new Set(
      existing
        .filter(
          (e) => e.status === ShippingQueueStatus.WAITING && !e.isUrgent,
        )
        .map((e) => e.id),
    );

    const filtered = items.filter((i) => editable.has(i.id));
    if (filtered.length === 0) return { success: true, data: { updated: 0 } };

    await prisma.$transaction(async (tx) => {
      for (const it of filtered) {
        await tx.shippingQueue.update({
          where: { id: it.id },
          data: { priority: it.priority },
        });
      }
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: filtered.map((i) => i.id).join(","),
      newData: { count: filtered.length, reorder: true },
    });

    return { success: true, data: { updated: filtered.length } };
  }

  /**
   * Kuyruktan çıkar (CANCELLED). DONE kayıtlar geçmiş olarak kalır.
   */
  async cancel(
    id: string,
    reason: string | null,
    userId: string | undefined,
  ): Promise<ApiResponse<{ id: string }>> {
    if (!userId) throw AppError.unauthorized();

    const existing = await prisma.shippingQueue.findUnique({
      where: { id },
      select: { id: true, orderId: true, status: true },
    });
    if (!existing) throw AppError.notFound("Kuyruk kaydı bulunamadı");
    if (existing.status === ShippingQueueStatus.DONE) {
      throw AppError.badRequest("Tamamlanmış kayıt iptal edilemez");
    }
    if (existing.status === ShippingQueueStatus.CANCELLED) {
      return { success: true, data: { id } };
    }

    await prisma.shippingQueue.update({
      where: { id },
      data: {
        status: ShippingQueueStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: reason,
      },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: id,
      oldData: { status: existing.status },
      newData: { status: ShippingQueueStatus.CANCELLED, cancelReason: reason },
    });

    return { success: true, data: { id } };
  }

  /**
   * Operatör kuyruktan sıradakini alır. SKIP LOCKED ile yarış önler.
   */
  async takeNext(
    userId: string | undefined,
  ): Promise<ApiResponse<ReturnType<typeof shapeQueueRow> | null>> {
    if (!userId) throw AppError.unauthorized();

    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "shipping_queue"
        WHERE "status" = 'WAITING'
        ORDER BY
          "isUrgent" DESC,
          "urgentMarkedAt" ASC NULLS LAST,
          "priority" ASC,
          "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      if (rows.length === 0) return null;
      const id = rows[0].id;

      const updated = await tx.shippingQueue.update({
        where: { id },
        data: {
          status: ShippingQueueStatus.TAKEN,
          assignedOperatorId: userId,
          takenAt: new Date(),
        },
        include: QUEUE_INCLUDE,
      });
      return updated;
    });

    if (!result) return { success: true, data: null, message: "Kuyruk boş" };

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: result.id,
      newData: { status: ShippingQueueStatus.TAKEN, assignedOperatorId: userId },
    });

    return { success: true, data: shapeQueueRow(result) };
  }

  /**
   * Operatör belirli bir kuyruk satırını alır (idempotent — kendisinin alabilir).
   */
  async takeById(
    id: string,
    userId: string | undefined,
  ): Promise<ApiResponse<ReturnType<typeof shapeQueueRow>>> {
    if (!userId) throw AppError.unauthorized();

    const existing = await prisma.shippingQueue.findUnique({
      where: { id },
      select: { id: true, status: true, assignedOperatorId: true },
    });
    if (!existing) throw AppError.notFound("Kuyruk kaydı bulunamadı");

    if (existing.status === ShippingQueueStatus.TAKEN) {
      if (existing.assignedOperatorId !== userId) {
        throw AppError.conflict(
          "Bu kayıt başka bir operatör tarafından alınmış",
        );
      }
      // Aynı operatör tekrar — fetch & dön
      const full = await prisma.shippingQueue.findUnique({
        where: { id },
        include: QUEUE_INCLUDE,
      });
      return { success: true, data: shapeQueueRow(full!) };
    }

    if (existing.status !== ShippingQueueStatus.WAITING) {
      throw AppError.badRequest(`Kayıt durumu uygun değil (${existing.status})`);
    }

    const updated = await prisma.shippingQueue.update({
      where: { id },
      data: {
        status: ShippingQueueStatus.TAKEN,
        assignedOperatorId: userId,
        takenAt: new Date(),
      },
      include: QUEUE_INCLUDE,
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: id,
      newData: { status: ShippingQueueStatus.TAKEN, assignedOperatorId: userId },
    });

    return { success: true, data: shapeQueueRow(updated) };
  }

  /**
   * Operatör operasyondan vazgeçer — WAITING'e geri döner (kuyruğun başına).
   */
  async release(
    id: string,
    userId: string | undefined,
  ): Promise<ApiResponse<{ id: string }>> {
    if (!userId) throw AppError.unauthorized();

    const existing = await prisma.shippingQueue.findUnique({
      where: { id },
      select: { id: true, status: true, assignedOperatorId: true },
    });
    if (!existing) throw AppError.notFound("Kuyruk kaydı bulunamadı");
    if (existing.status !== ShippingQueueStatus.TAKEN) {
      throw AppError.badRequest("Sadece alınmış kayıt bırakılabilir");
    }
    if (existing.assignedOperatorId !== userId) {
      throw AppError.forbidden("Bu kayıt sizin değil");
    }

    await prisma.shippingQueue.update({
      where: { id },
      data: {
        status: ShippingQueueStatus.WAITING,
        assignedOperatorId: null,
        takenAt: null,
      },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: id,
      newData: { status: ShippingQueueStatus.WAITING, released: true },
    });

    return { success: true, data: { id } };
  }

  /**
   * Operatör tamamlandı diyor — kuyruk satırı DONE'a geçer. Bu çağrı sevkiyat
   * oluşturmaz; çuvalları sevkiyata gönderme planlamacının/sevkiyat ekibinin işi.
   * En az bir top sipariş satırına bağlanmış olmalı (allocation > 0).
   */
  async complete(
    id: string,
    userId: string | undefined,
  ): Promise<ApiResponse<{ id: string; allocatedRollCount: number }>> {
    if (!userId) throw AppError.unauthorized();

    const existing = await prisma.shippingQueue.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        assignedOperatorId: true,
        orderId: true,
        order: { select: { orderNumber: true } },
      },
    });
    if (!existing) throw AppError.notFound("Kuyruk kaydı bulunamadı");
    if (existing.status !== ShippingQueueStatus.TAKEN) {
      throw AppError.badRequest(
        "Sadece alınmış (TAKEN) kayıt tamamlanabilir — önce sırasını alın",
      );
    }
    if (existing.assignedOperatorId !== userId) {
      throw AppError.forbidden("Bu kayıt sizin değil");
    }

    // Bu siparişe READY_FOR_SHIP statüsünde en az bir top allocate edilmiş mi?
    const allocated = await prisma.orderAllocation.count({
      where: {
        orderLine: { orderId: existing.orderId },
        roll: { status: RollStatus.READY_FOR_SHIP },
      },
    });
    if (allocated === 0) {
      throw AppError.badRequest(
        "Hiç top siparişe atanmamış — çuvallara top ekleyin ve tartın",
      );
    }

    await prisma.shippingQueue.update({
      where: { id },
      data: {
        status: ShippingQueueStatus.DONE,
        completedAt: new Date(),
      },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: id,
      newData: {
        status: ShippingQueueStatus.DONE,
        orderNumber: existing.order.orderNumber,
        allocatedRollCount: allocated,
      },
    });

    return {
      success: true,
      data: { id, allocatedRollCount: allocated },
      message: `${existing.order.orderNumber} sevkiyata hazır — ${allocated} top bağlandı`,
    };
  }

  /**
   * Sipariş gereklilikleri — satır bazında istenen / tahsis edilmiş / kalan miktar.
   * Operatörün ihtiyaç ekranı için.
   */
  async getRequirements(
    id: string,
  ): Promise<ApiResponse<ReturnType<typeof shapeQueueRow>>> {
    const row = await prisma.shippingQueue.findUnique({
      where: { id },
      include: QUEUE_INCLUDE,
    });
    if (!row) throw AppError.notFound("Kuyruk kaydı bulunamadı");
    return { success: true, data: shapeQueueRow(row) };
  }
}

// =============================================================================
// TeksERP - Packaging Queue Service (rulo seviyesinde)
// =============================================================================
// Planlamacı, depodaki (WAREHOUSE) rulları açık siparişlerle eşler ve paket
// kuyruğunu yönetir. Bir satır = bir rulonun paketleme görevi.
//
// - plannedOrderId boş bırakılabilir → stoğa paketleme (sonradan atanabilir).
// - SERVICE_PRODUCTION rulları: Roll.ownerCustomerId dolu ise plannedOrderId
//   sadece o müşterinin siparişi olabilir (service-level enforce).
// - Operatör seçim yapmaz → kuyruğun en üstündeki ruloyu alır (TAKEN).
// - takeNext SKIP LOCKED ile yarış önler.
// - Paketleme finalize'inde markDoneByRollId çağrılır (sevkiyatta değil).
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { OrderStatus, PackagingQueueStatus, Prisma, RollStatus } from "@prisma/client";

const TABLE = "packaging_queue";

interface AddToQueueInput {
  rollId: string;
  plannedOrderId?: string | null;
  priority?: number;
  note?: string | null;
}

interface BulkAddInput {
  items: Array<{ rollId: string; plannedOrderId?: string | null; note?: string | null }>;
}

interface ReorderInput {
  items: Array<{ id: string; priority: number }>;
}

interface RemoveInput {
  id: string;
  cancelReason?: string | null;
}

// Tek noktadan kontrol edilen include şekli — admin/operator/take her yerde aynı.
const QUEUE_INCLUDE = {
  roll: {
    select: {
      id: true,
      barcode: true,
      status: true,
      initialQty: true,
      currentQty: true,
      weightKg: true,
      width: true,
      qualityGrade: true,
      ownerCustomerId: true,
      item: { select: { id: true, code: true, name: true } },
      variant: { select: { id: true, code: true, name: true } },
      ownerCustomer: { select: { id: true, code: true, name: true } },
    },
  },
  plannedOrder: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      deadline: true,
      customer: { select: { id: true, code: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  },
  addedBy: { select: { id: true, fullName: true } },
  assignedOperator: { select: { id: true, fullName: true } },
} satisfies Prisma.PackagingQueueInclude;

type QueueRowWithIncludes = Prisma.PackagingQueueGetPayload<{ include: typeof QUEUE_INCLUDE }>;

function shapeQueueRow(q: QueueRowWithIncludes) {
  return {
    id: q.id,
    rollId: q.rollId,
    plannedOrderId: q.plannedOrderId,
    priority: q.priority,
    isUrgent: q.isUrgent,
    urgentMarkedAt: q.urgentMarkedAt,
    status: q.status,
    note: q.note,
    assignedOperator: q.assignedOperator,
    addedBy: q.addedBy,
    takenAt: q.takenAt,
    completedAt: q.completedAt,
    cancelledAt: q.cancelledAt,
    cancelReason: q.cancelReason,
    createdAt: q.createdAt,
    roll: q.roll,
    plannedOrder: q.plannedOrder,
  };
}

/**
 * Plannable order kontrolü — kuyruğa atanabilir mi?
 * PENDING (onaysız), COMPLETED, CANCELLED → atanamaz.
 * Müşteri kilidi (SERVICE_PRODUCTION) çağıran fonksiyonda kontrol edilir.
 */
async function assertOrderAssignable(orderId: string): Promise<{ customerId: string; orderNumber: string }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, status: true, customerId: true },
  });
  if (!order) throw AppError.notFound("Sipariş bulunamadı");
  if (order.status === OrderStatus.PENDING) {
    throw AppError.badRequest("Onaysız sipariş kuyruğa atanamaz");
  }
  if (order.status === OrderStatus.COMPLETED || order.status === OrderStatus.CANCELLED) {
    throw AppError.badRequest("Tamamlanmış veya iptal edilmiş sipariş kuyruğa atanamaz");
  }
  return { customerId: order.customerId, orderNumber: order.orderNumber };
}

/**
 * Roll WAREHOUSE'da mı + SERVICE_PRODUCTION kilidi tutar mı?
 */
async function assertRollQueueable(
  rollId: string,
  plannedOrderId: string | null
): Promise<{ ownerCustomerId: string | null }> {
  const roll = await prisma.roll.findUnique({
    where: { id: rollId },
    select: { id: true, barcode: true, status: true, ownerCustomerId: true },
  });
  if (!roll) throw AppError.notFound("Rulo bulunamadı");
  if (roll.status !== RollStatus.WAREHOUSE) {
    throw AppError.badRequest(`Rulo (${roll.barcode}) depo statüsünde değil, kuyruğa eklenemez`);
  }
  if (roll.ownerCustomerId && plannedOrderId) {
    const order = await prisma.order.findUnique({
      where: { id: plannedOrderId },
      select: { customerId: true },
    });
    if (!order) throw AppError.notFound("Sipariş bulunamadı");
    if (order.customerId !== roll.ownerCustomerId) {
      throw AppError.badRequest(
        "Müşteri-malı rulo (Fason Üretim) sadece kendi müşterisinin siparişine atanabilir"
      );
    }
  }
  return { ownerCustomerId: roll.ownerCustomerId };
}

export class PackagingQueueService {
  /**
   * Kuyruk listesi (admin/planner). Default: aktif kayıtlar (WAITING + TAKEN),
   * acil önce, sonra priority+createdAt sırasıyla.
   */
  async getQueue(params: { status?: PackagingQueueStatus | "ALL" }): Promise<ApiResponse<unknown[]>> {
    const where: Prisma.PackagingQueueWhereInput =
      params.status === "ALL"
        ? {}
        : params.status
          ? { status: params.status }
          : { status: { in: [PackagingQueueStatus.WAITING, PackagingQueueStatus.TAKEN] } };

    const items = await prisma.packagingQueue.findMany({
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
   * Kuyruğa tek rulo ekle. Rulo WAREHOUSE olmalı, aktif kuyrukta olmamalı.
   * plannedOrderId verildiyse sipariş atanabilir + müşteri kilidi geçerli olmalı.
   */
  async addToQueue(input: AddToQueueInput, userId: string | undefined): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();

    const plannedOrderId = input.plannedOrderId ?? null;
    let orderNumber: string | null = null;

    if (plannedOrderId) {
      const o = await assertOrderAssignable(plannedOrderId);
      orderNumber = o.orderNumber;
    }
    await assertRollQueueable(input.rollId, plannedOrderId);

    const existingActive = await prisma.packagingQueue.findFirst({
      where: {
        rollId: input.rollId,
        status: { in: [PackagingQueueStatus.WAITING, PackagingQueueStatus.TAKEN] },
      },
      select: { id: true, status: true },
    });
    if (existingActive) {
      throw AppError.conflict(
        existingActive.status === PackagingQueueStatus.TAKEN
          ? "Bu rulo şu an bir operatör tarafından paketleniyor"
          : "Bu rulo zaten kuyrukta"
      );
    }

    let priority = input.priority;
    if (priority === undefined) {
      const last = await prisma.packagingQueue.aggregate({
        where: { status: PackagingQueueStatus.WAITING },
        _max: { priority: true },
      });
      priority = (last._max.priority ?? -1) + 1;
    }

    const created = await prisma.packagingQueue.create({
      data: {
        rollId: input.rollId,
        plannedOrderId,
        priority,
        note: input.note ?? null,
        addedByUserId: userId,
      },
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: TABLE,
      recordId: created.id,
      newData: {
        rollId: created.rollId,
        plannedOrderId: created.plannedOrderId,
        orderNumber,
        priority: created.priority,
      },
    });

    return { success: true, data: created, message: "Kuyruğa eklendi" };
  }

  /**
   * Toplu ekleme — planner sayfası birden çok ruloyu tek call ile atar.
   * Bir item başarısız olursa transaction tümünü geri sarar.
   */
  async bulkAdd(
    input: BulkAddInput,
    userId: string | undefined
  ): Promise<ApiResponse<{ added: number }>> {
    if (!userId) throw AppError.unauthorized();
    if (input.items.length === 0) return { success: true, data: { added: 0 } };

    // Pre-validation: tek tek doğrula (transaction içinde uzun I/O yapma)
    for (const item of input.items) {
      if (item.plannedOrderId) await assertOrderAssignable(item.plannedOrderId);
      await assertRollQueueable(item.rollId, item.plannedOrderId ?? null);
    }
    const rollIds = input.items.map((i) => i.rollId);
    const conflicts = await prisma.packagingQueue.findMany({
      where: {
        rollId: { in: rollIds },
        status: { in: [PackagingQueueStatus.WAITING, PackagingQueueStatus.TAKEN] },
      },
      select: { rollId: true },
    });
    if (conflicts.length > 0) {
      throw AppError.conflict(
        `${conflicts.length} rulo zaten aktif kuyrukta — önce çıkarın`
      );
    }

    const last = await prisma.packagingQueue.aggregate({
      where: { status: PackagingQueueStatus.WAITING },
      _max: { priority: true },
    });
    let nextPriority = (last._max.priority ?? -1) + 1;

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.packagingQueue.createManyAndReturn({
        data: input.items.map((i) => ({
          rollId: i.rollId,
          plannedOrderId: i.plannedOrderId ?? null,
          priority: nextPriority++,
          note: i.note ?? null,
          addedByUserId: userId,
        })),
        select: { id: true, rollId: true, plannedOrderId: true, priority: true },
      });
      return created;
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: TABLE,
      recordId: result.map((r) => r.id).join(","),
      newData: { count: result.length },
    });

    return { success: true, data: { added: result.length }, message: `${result.length} rulo eklendi` };
  }

  /**
   * Kuyruktaki bir kaydın atanmış siparişini değiştir (planner UI).
   * Sadece WAITING için. Operatör almışsa atama değiştirmiyoruz.
   */
  async updatePlannedOrder(
    id: string,
    plannedOrderId: string | null,
    userId: string | undefined
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();

    const item = await prisma.packagingQueue.findUnique({
      where: { id },
      select: { id: true, rollId: true, plannedOrderId: true, status: true },
    });
    if (!item) throw AppError.notFound("Kuyruk kaydı bulunamadı");
    if (item.status !== PackagingQueueStatus.WAITING) {
      throw AppError.badRequest("Sadece bekleyen kayıtların ataması değiştirilebilir");
    }

    if (plannedOrderId) await assertOrderAssignable(plannedOrderId);
    await assertRollQueueable(item.rollId, plannedOrderId);

    const updated = await prisma.packagingQueue.update({
      where: { id },
      data: { plannedOrderId },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: updated.id,
      oldData: { plannedOrderId: item.plannedOrderId },
      newData: { plannedOrderId: updated.plannedOrderId },
    });

    return { success: true, data: updated, message: "Sipariş ataması güncellendi" };
  }

  /**
   * Toplu öncelik güncelleme (sürükle-bırak sonrası). Tek transaction.
   */
  async reorder(input: ReorderInput, userId: string | undefined): Promise<ApiResponse<{ updated: number }>> {
    if (!userId) throw AppError.unauthorized();
    if (input.items.length === 0) {
      return { success: true, data: { updated: 0 } };
    }

    const ids = input.items.map((i) => i.id);
    const existing = await prisma.packagingQueue.findMany({
      where: { id: { in: ids }, status: PackagingQueueStatus.WAITING },
      select: { id: true },
    });
    if (existing.length !== input.items.length) {
      throw AppError.badRequest("Bazı kuyruk kayıtları bulunamadı veya artık WAITING değil");
    }

    const updateIds = input.items.map((i) => i.id);
    const updatePriorities = input.items.map((i) => i.priority);
    await prisma.$executeRaw`
      UPDATE "packaging_queue" AS pq
      SET "priority" = data."priority"
      FROM unnest(${updateIds}::text[], ${updatePriorities}::int[]) AS data("id", "priority")
      WHERE pq."id" = data."id"
    `;

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: ids.join(","),
      newData: { reorderedCount: input.items.length },
    });

    return { success: true, data: { updated: input.items.length }, message: "Sıralama güncellendi" };
  }

  /**
   * Kuyruktan çıkar (status=CANCELLED). Sadece WAITING için.
   */
  async removeFromQueue(input: RemoveInput, userId: string | undefined): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();

    const item = await prisma.packagingQueue.findUnique({
      where: { id: input.id },
      select: { id: true, status: true, rollId: true },
    });
    if (!item) throw AppError.notFound("Kuyruk kaydı bulunamadı");
    if (item.status !== PackagingQueueStatus.WAITING) {
      throw AppError.badRequest(
        item.status === PackagingQueueStatus.TAKEN
          ? "Operatör tarafından alınmış iş iptal edilemez"
          : "Sadece bekleyen kayıtlar iptal edilebilir"
      );
    }

    const updated = await prisma.packagingQueue.update({
      where: { id: input.id },
      data: {
        status: PackagingQueueStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: input.cancelReason ?? null,
      },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: updated.id,
      oldData: { status: item.status },
      newData: { status: updated.status, cancelReason: updated.cancelReason },
    });

    return { success: true, data: updated, message: "Kuyruktan çıkarıldı" };
  }

  /**
   * Acil olarak işaretle / iptal et.
   */
  async setUrgent(
    id: string,
    isUrgent: boolean,
    userId: string | undefined
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();

    const item = await prisma.packagingQueue.findUnique({
      where: { id },
      select: { id: true, status: true, isUrgent: true, urgentMarkedAt: true },
    });
    if (!item) throw AppError.notFound("Kuyruk kaydı bulunamadı");
    if (
      item.status !== PackagingQueueStatus.WAITING &&
      item.status !== PackagingQueueStatus.TAKEN
    ) {
      throw AppError.badRequest("Sadece aktif kayıtlar acil işaretlenebilir");
    }

    if (item.isUrgent === isUrgent) {
      return { success: true, data: item, message: "Değişiklik yok" };
    }

    const updated = await prisma.packagingQueue.update({
      where: { id },
      data: {
        isUrgent,
        urgentMarkedAt: isUrgent ? new Date() : null,
      },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: updated.id,
      oldData: { isUrgent: item.isUrgent },
      newData: { isUrgent: updated.isUrgent, urgentMarkedAt: updated.urgentMarkedAt },
    });

    return {
      success: true,
      data: updated,
      message: isUrgent ? "Acil olarak işaretlendi" : "Acil işareti kaldırıldı",
    };
  }

  /**
   * Operatör için sayfalı aktif kuyruk listesi (WAITING + TAKEN).
   */
  async getAvailable(params: {
    limit: number;
    offset: number;
  }): Promise<ApiResponse<unknown[]> & { pagination: { total: number; limit: number; offset: number; hasMore: boolean } }> {
    const { limit, offset } = params;

    const where: Prisma.PackagingQueueWhereInput = {
      status: { in: [PackagingQueueStatus.WAITING, PackagingQueueStatus.TAKEN] },
    };

    const [total, items] = await Promise.all([
      prisma.packagingQueue.count({ where }),
      prisma.packagingQueue.findMany({
        where,
        orderBy: [
          { isUrgent: "desc" },
          { urgentMarkedAt: { sort: "asc", nulls: "last" } },
          { priority: "asc" },
          { createdAt: "asc" },
        ],
        skip: offset,
        take: limit,
        include: QUEUE_INCLUDE,
      }),
    ]);

    return {
      success: true,
      data: items.map(shapeQueueRow),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      },
    };
  }

  /**
   * Belirli kuyruk kaydını operatöre atar (TAKEN). SKIP LOCKED yarış koruması.
   * TAKEN da seçilebilir (vardiya/tab kapanma) — idempotent.
   */
  async takeById(id: string, userId: string | undefined): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();

    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: PackagingQueueStatus; takenAt: Date | null }>>`
        SELECT "id", "status", "takenAt"
        FROM "packaging_queue"
        WHERE "id" = ${id} AND "status" IN ('WAITING', 'TAKEN')
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return null;
      const existing = rows[0];

      const updated = await tx.packagingQueue.update({
        where: { id: existing.id },
        data: {
          status: PackagingQueueStatus.TAKEN,
          assignedOperatorId: userId,
          takenAt: existing.takenAt ?? new Date(),
        },
        include: QUEUE_INCLUDE,
      });
      return updated;
    });

    if (!result) {
      throw AppError.conflict("Bu iş artık kuyrukta değil (paketlendi veya iptal oldu)");
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: result.id,
      newData: { status: result.status, assignedOperatorId: userId },
    });

    return { success: true, data: shapeQueueRow(result), message: "İş alındı" };
  }

  /**
   * Kuyruğun tepesindeki WAITING kaydı operatöre verir → TAKEN.
   */
  async takeNext(userId: string | undefined): Promise<ApiResponse<unknown | null>> {
    if (!userId) throw AppError.unauthorized();

    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "packaging_queue"
        WHERE "status" = 'WAITING'
        ORDER BY "isUrgent" DESC, "urgentMarkedAt" ASC NULLS LAST, "priority" ASC, "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return null;
      const id = rows[0].id;

      const updated = await tx.packagingQueue.update({
        where: { id },
        data: {
          status: PackagingQueueStatus.TAKEN,
          assignedOperatorId: userId,
          takenAt: new Date(),
        },
        include: QUEUE_INCLUDE,
      });
      return updated;
    });

    if (!result) {
      return { success: true, data: null, message: "Kuyrukta bekleyen iş yok" };
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: result.id,
      newData: { status: result.status, assignedOperatorId: userId },
    });

    return { success: true, data: shapeQueueRow(result), message: "İş alındı" };
  }

  /**
   * Belirli bir sipariş için atanabilir depo rulularını döner.
   * - WAREHOUSE statüsü, aktif kuyrukta (WAITING/TAKEN) olmayan rulolar.
   * - SERVICE_PRODUCTION rulları (`ownerCustomerId` dolu) sadece sipariş müşterisine aitse görünür.
   * - `onlyMatching=true` → siparişin satırlarındaki item.id veya baseItem.id ile eşleşenler.
   * Roll listesi `operations.operationType` (KURSUN_APPLIED tespiti), `properties` ve renk içerir.
   */
  async getOrderCandidates(
    orderId: string,
    options: { onlyMatching?: boolean; search?: string } = {}
  ): Promise<ApiResponse<unknown[]>> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        customerId: true,
        status: true,
        lines: { select: { itemId: true, item: { select: { baseItemId: true } } } },
      },
    });
    if (!order) throw AppError.notFound("Sipariş bulunamadı");

    const activeQueueRolls = await prisma.packagingQueue.findMany({
      where: { status: { in: [PackagingQueueStatus.WAITING, PackagingQueueStatus.TAKEN] } },
      select: { rollId: true },
    });
    const excludeRollIds = activeQueueRolls.map((q) => q.rollId);

    const where: Prisma.RollWhereInput = {
      status: RollStatus.WAREHOUSE,
      ...(excludeRollIds.length > 0 ? { id: { notIn: excludeRollIds } } : {}),
      OR: [{ ownerCustomerId: null }, { ownerCustomerId: order.customerId }],
    };

    if (options.onlyMatching) {
      const itemIds = new Set<string>();
      for (const line of order.lines) {
        itemIds.add(line.itemId);
        if (line.item.baseItemId) itemIds.add(line.item.baseItemId);
      }
      if (itemIds.size > 0) {
        where.AND = [
          ...(Array.isArray(where.AND) ? (where.AND as Prisma.RollWhereInput[]) : []),
          {
            OR: [
              { itemId: { in: Array.from(itemIds) } },
              { item: { baseItemId: { in: Array.from(itemIds) } } },
            ],
          },
        ];
      }
    }

    if (options.search) {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Prisma.RollWhereInput[]) : []),
        {
          OR: [
            { barcode: { contains: options.search, mode: "insensitive" } },
            { item: { name: { contains: options.search, mode: "insensitive" } } },
            { item: { code: { contains: options.search, mode: "insensitive" } } },
          ],
        },
      ];
    }

    const rolls = await prisma.roll.findMany({
      where,
      orderBy: [{ createdAt: "asc" }],
      take: 500,
      include: {
        item: { include: { color: { select: { id: true, code: true, name: true, hex: true } } } },
        variant: { select: { id: true, code: true, name: true } },
        ownerCustomer: { select: { id: true, code: true, name: true } },
        operations: { select: { operationType: true } },
        properties: {
          select: {
            propertyId: true,
            property: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });

    return { success: true, data: rolls };
  }

  /**
   * Seçilen rulları belirli bir siparişe ata. Sonra WAITING kayıtlarını
   * `plannedOrder.deadline ASC NULLS LAST` sırasına göre yeniden önceliklendir.
   */
  async assignRollsToOrder(
    orderId: string,
    rollIds: string[],
    note: string | null,
    userId: string | undefined
  ): Promise<ApiResponse<{ added: number }>> {
    if (!userId) throw AppError.unauthorized();
    if (rollIds.length === 0) return { success: true, data: { added: 0 } };

    const orderInfo = await assertOrderAssignable(orderId);

    for (const rollId of rollIds) {
      await assertRollQueueable(rollId, orderId);
    }

    const conflicts = await prisma.packagingQueue.findMany({
      where: {
        rollId: { in: rollIds },
        status: { in: [PackagingQueueStatus.WAITING, PackagingQueueStatus.TAKEN] },
      },
      select: { rollId: true },
    });
    if (conflicts.length > 0) {
      throw AppError.conflict(
        `${conflicts.length} rulo zaten aktif kuyrukta — önce çıkarın`
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const last = await tx.packagingQueue.aggregate({
        where: { status: PackagingQueueStatus.WAITING },
        _max: { priority: true },
      });
      let nextPriority = (last._max.priority ?? -1) + 1;

      const created = await tx.packagingQueue.createManyAndReturn({
        data: rollIds.map((rollId) => ({
          rollId,
          plannedOrderId: orderId,
          priority: nextPriority++,
          note: note ?? null,
          addedByUserId: userId,
        })),
        select: { id: true },
      });

      await this.rebalanceWaitingByDeadline(tx);
      return created;
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: TABLE,
      recordId: result.map((r) => r.id).join(","),
      newData: { count: result.length, orderId, orderNumber: orderInfo.orderNumber },
    });

    return {
      success: true,
      data: { added: result.length },
      message: `${result.length} rulo siparişe atandı ve termine göre sıralandı`,
    };
  }

  /**
   * WAITING + non-urgent kayıtların priority'sini `plannedOrder.deadline ASC NULLS LAST`
   * sırasına göre yeniden hesapla. Acil (isUrgent) kayıtlar listede zaten tepede tutulur
   * (order: isUrgent DESC, urgentMarkedAt ASC) — bu fonksiyon onlara dokunmaz.
   */
  async rebalanceWaitingByDeadline(tx: Prisma.TransactionClient): Promise<void> {
    const items = await tx.packagingQueue.findMany({
      where: { status: PackagingQueueStatus.WAITING, isUrgent: false },
      select: {
        id: true,
        createdAt: true,
        plannedOrder: { select: { deadline: true } },
      },
    });
    if (items.length === 0) return;

    const sorted = items.slice().sort((a, b) => {
      const ad = a.plannedOrder?.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
      const bd = b.plannedOrder?.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
      if (ad !== bd) return ad - bd;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const ids = sorted.map((i) => i.id);
    const priorities = sorted.map((_, idx) => idx * 10);
    await tx.$executeRaw`
      UPDATE "packaging_queue" AS pq
      SET "priority" = data."priority"
      FROM unnest(${ids}::text[], ${priorities}::int[]) AS data("id", "priority")
      WHERE pq."id" = data."id"
    `;
  }

  /**
   * Paketleme finalize'inde çağrılır — bu rulonun aktif kuyruk satırı DONE olur.
   * Aktif satır yoksa sessizce no-op (operatör kuyruksuz da paketleyebiliyorsa).
   */
  async markDoneByRollId(
    rollId: string,
    userId: string | undefined,
    tx: Prisma.TransactionClient
  ): Promise<void> {
    const active = await tx.packagingQueue.findFirst({
      where: {
        rollId,
        status: { in: [PackagingQueueStatus.WAITING, PackagingQueueStatus.TAKEN] },
      },
      select: { id: true, status: true },
    });
    if (!active) return;

    const updated = await tx.packagingQueue.update({
      where: { id: active.id },
      data: { status: PackagingQueueStatus.DONE, completedAt: new Date() },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: updated.id,
      oldData: { status: active.status },
      newData: { status: updated.status, completedAt: updated.completedAt },
    });
  }
}

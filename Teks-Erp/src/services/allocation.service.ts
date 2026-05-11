// =============================================================================
// TeksERP - Allocation Service
// =============================================================================
// Sipariş ↔ stok eşleştirme akışı için (Allocation Center).
// Üretim akışındaki tambur.allocate'tan farkı:
//   - PRODUCED yanında READY_FOR_SHIP ve A1_STOCK durumlarını da kabul eder
//     (stoktan tahsis senaryosu için)
//   - Bekleyen siparişleri ve uyumlu stok rolleri dökme endpoint'leri sağlar
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { OrderStatus, Prisma, RollStatus } from "@prisma/client";
import { recomputeOrderStatus } from "./helpers/order-status.helper";
import { cursorWhere, buildNextCursor, decodeCursor } from "../utils/cursor";

const ELIGIBLE_ROLL_STATUSES: RollStatus[] = [
  RollStatus.PRODUCED,
  RollStatus.READY_FOR_SHIP,
  RollStatus.A1_STOCK,
];

// Phase 1: IN_PRODUCTION otomatik atanmıyor; APPROVED + PARTIAL_SHIPPED yeterli.
// Tahsis ekranında PENDING (henüz onaysız) ve COMPLETED/CANCELLED görünmez.
const PENDING_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.APPROVED,
  OrderStatus.PARTIAL_SHIPPED,
];

export class AllocationService {
  /**
   * Tahsis bekleyen siparişler — açık durumdaki ve kalan ihtiyacı olan.
   * Her satır için: requested, allocated, remaining alanları dönülür.
   *
   * Pagination: q (orderNumber/customer/item ILIKE), limit (default 20, max 100),
   * offset, opsiyonel customerId filtre. NOT: totalRemaining > 0 filtresi
   * post-process olduğundan dönen sayfa "limit"ten az olabilir; pagination.total
   * filtre öncesi DB count'tur (üst sınır). Frontend hasMore ile infinite scroll yapar.
   */
  async getPendingOrders(params?: {
    q?: string;
    limit?: number;
    offset?: number;
    customerId?: string;
    cursor?: string;
    mode?: "offset" | "cursor";
  }): Promise<
    | (ApiResponse<unknown[]> & {
        pagination: { total: number; limit: number; offset: number; hasMore: boolean };
      })
    | (ApiResponse<unknown[]> & {
        pagination: {
          nextCursor: string | null;
          hasMore: boolean;
          limit: number;
          totalEstimate?: number;
        };
      })
  > {
    const limit = Math.min(100, Math.max(1, params?.limit ?? 20));
    const offset = Math.max(0, params?.offset ?? 0);
    const q = params?.q?.trim();
    const useCursor = params?.mode === "cursor" || !!params?.cursor;

    const searchOR: Prisma.OrderWhereInput[] | undefined = q
      ? [
          { orderNumber: { contains: q, mode: "insensitive" } },
          { customer: { name: { contains: q, mode: "insensitive" } } },
          { lines: { some: { item: { name: { contains: q, mode: "insensitive" } } } } },
        ]
      : undefined;

    const baseWhere: Prisma.OrderWhereInput = {
      status: { in: PENDING_ORDER_STATUSES },
      ...(params?.customerId ? { customerId: params.customerId } : {}),
      ...(searchOR ? { OR: searchOR } : {}),
    };

    // Cursor mode için createdAt DESC tek başına tie-breaker olarak yeterli;
    // deadline sıralaması cursor karmaşıklaştırır. Cursor mode'da createdAt
    // sıralaması kullanıyoruz (tutarlı tie-breaker).
    const cursor = params?.cursor ? decodeCursor(params.cursor) : null;
    const where: Prisma.OrderWhereInput = useCursor && cursor
      ? { AND: [baseWhere, cursorWhere(cursor)] }
      : baseWhere;

    const orderSelect = {
      id: true,
      orderNumber: true,
      status: true,
      deadline: true,
      createdAt: true, // cursor için zorunlu
      customer: { select: { id: true, code: true, name: true } },
      lines: {
        select: {
          id: true,
          itemId: true,
          variantId: true,
          quantity: true,
          item: { select: { code: true, name: true, itemType: true } },
          variant: { select: { code: true, name: true } },
          allocations: { select: { allocatedQty: true } },
        },
      },
    } as const;

    const orderByOffset: Prisma.OrderOrderByWithRelationInput[] = [
      { deadline: { sort: "asc", nulls: "last" } },
      { createdAt: "desc" },
    ];
    const orderByCursor: Prisma.OrderOrderByWithRelationInput[] = [
      { createdAt: "desc" },
      { id: "desc" },
    ];

    const [totalEstimate, ordersRaw] = await Promise.all([
      prisma.order.count({ where: baseWhere }),
      useCursor
        ? prisma.order.findMany({
            where,
            select: orderSelect,
            orderBy: orderByCursor,
            take: limit + 1,
          })
        : prisma.order.findMany({
            where,
            select: orderSelect,
            orderBy: orderByOffset,
            skip: offset,
            take: limit,
          }),
    ]);

    const total = totalEstimate;
    const hasMoreCursor = useCursor && ordersRaw.length > limit;
    const orders = hasMoreCursor ? ordersRaw.slice(0, limit) : ordersRaw;

    const data = orders
      .map((o) => {
        const lines = o.lines.map((line) => {
          const allocated = line.allocations.reduce(
            (s, a) => s + a.allocatedQty,
            0
          );
          return {
            lineId: line.id,
            itemId: line.itemId,
            itemCode: line.item.code,
            itemName: line.item.name,
            itemType: line.item.itemType,
            variantId: line.variantId,
            variantCode: line.variant?.code ?? null,
            variantName: line.variant?.name ?? null,
            requested: line.quantity,
            allocated,
            remaining: Math.max(0, line.quantity - allocated),
          };
        });
        const totalRemaining = lines.reduce((s, l) => s + l.remaining, 0);
        return {
          orderId: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          deadline: o.deadline,
          customer: o.customer,
          totalRemaining,
          lines,
          // cursor için _createdAt'i veride sakla (response'a dönmez)
          _createdAt: o.createdAt,
        };
      })
      // Tüm satırları dolu olan siparişleri çıkar (tahsis ekranında işin yok)
      .filter((o) => o.totalRemaining > 0);

    if (useCursor) {
      const last = orders[orders.length - 1];
      const nextCursor = hasMoreCursor && last
        ? buildNextCursor({ id: last.id, createdAt: last.createdAt })
        : null;
      return {
        success: true,
        data: data.map(({ _createdAt: _omit, ...rest }) => {
          void _omit;
          return rest;
        }),
        pagination: {
          nextCursor,
          hasMore: hasMoreCursor,
          limit,
          totalEstimate: total,
        },
      };
    }

    return {
      success: true,
      data: data.map(({ _createdAt: _omit, ...rest }) => {
        void _omit;
        return rest;
      }),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + orders.length < total,
      },
    };
  }

  /**
   * Bir sipariş satırına uygun stok rolleri.
   * Eşleşme:
   *   - itemId aynı
   *   - variantId aynı (line.variantId null ise tüm varyantlar uyar)
   *   - status PRODUCED / READY_FOR_SHIP / A1_STOCK
   *   - ownerCustomerId null veya order.customerId ile aynı (SERVICE_PRODUCTION koruması)
   *   - Roll'un kalan kapasitesi > 0 (mevcut tahsisler düşülür)
   */
  async getMatchingStockForLine(
    orderLineId: string
  ): Promise<ApiResponse<unknown>> {
    const orderLine = await prisma.orderLine.findUnique({
      where: { id: orderLineId },
      include: {
        order: { select: { id: true, customerId: true, orderNumber: true } },
      },
    });
    if (!orderLine) throw AppError.notFound("Sipariş satırı bulunamadı");

    const rolls = await prisma.roll.findMany({
      where: {
        itemId: orderLine.itemId,
        ...(orderLine.variantId ? { variantId: orderLine.variantId } : {}),
        status: { in: ELIGIBLE_ROLL_STATUSES },
        OR: [
          { ownerCustomerId: null },
          { ownerCustomerId: orderLine.order.customerId },
        ],
      },
      include: {
        item: { select: { code: true, name: true } },
        variant: { select: { code: true, name: true } },
        allocations: { select: { allocatedQty: true } },
        ownerCustomer: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const data = rolls
      .map((r) => {
        const allocatedTotal = r.allocations.reduce(
          (s, a) => s + a.allocatedQty,
          0
        );
        const remainingCapacity = Math.max(0, r.currentQty - allocatedTotal);
        return {
          rollId: r.id,
          barcode: r.barcode,
          status: r.status,
          itemCode: r.item.code,
          itemName: r.item.name,
          variantCode: r.variant?.code ?? null,
          variantName: r.variant?.name ?? null,
          currentQty: r.currentQty,
          weightKg: r.weightKg,
          width: r.width,
          qualityGrade: r.qualityGrade,
          allocatedTotal,
          remainingCapacity,
          ownerCustomer: r.ownerCustomer,
        };
      })
      .filter((r) => r.remainingCapacity > 0);

    return { success: true, data };
  }

  /**
   * Stoktan bir rolü sipariş satırına tahsis et.
   * tambur.allocate'tan farklı olarak READY_FOR_SHIP/A1_STOCK durumlarını da kabul eder.
   */
  async allocateStockToOrder(
    data: {
      rollId: string;
      orderLineId: string;
      allocatedQty: number;
    },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    if (!(data.allocatedQty > 0)) {
      throw AppError.badRequest("Tahsis miktarı pozitif olmalı");
    }

    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      include: { allocations: { select: { allocatedQty: true } } },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    if (!ELIGIBLE_ROLL_STATUSES.includes(roll.status)) {
      throw AppError.badRequest(
        `Top tahsis için uygun durumda değil (${roll.status}). ` +
          `Beklenen: ${ELIGIBLE_ROLL_STATUSES.join("/")}.`
      );
    }

    const orderLine = await prisma.orderLine.findUnique({
      where: { id: data.orderLineId },
      include: { order: { include: { customer: true } } },
    });
    if (!orderLine) throw AppError.notFound("Sipariş satırı bulunamadı");

    // SERVICE_PRODUCTION koruması: müşteri-malı top başka müşteriye atanamaz
    if (
      roll.ownerCustomerId &&
      roll.ownerCustomerId !== orderLine.order.customerId
    ) {
      throw AppError.badRequest(
        `Top ${roll.barcode} başka müşterinin malı (SERVICE_PRODUCTION) — atanamaz`
      );
    }

    // Variant uyumu (orderLine.variantId tanımlıysa eşleşmeli)
    if (orderLine.variantId && roll.variantId !== orderLine.variantId) {
      throw AppError.badRequest("Top varyantı sipariş satırı varyantına uymuyor");
    }

    if (roll.itemId !== orderLine.itemId) {
      throw AppError.badRequest("Top ürünü sipariş satırı ürününe uymuyor");
    }

    // Aynı (rol, satır) çifti zaten varsa hata
    const duplicate = await prisma.orderAllocation.findFirst({
      where: { rollId: data.rollId, orderLineId: data.orderLineId },
      select: { id: true },
    });
    if (duplicate) {
      throw AppError.conflict(
        `Top ${roll.barcode} zaten bu sipariş satırına tahsis edilmiş`
      );
    }

    const totalAllocated = roll.allocations.reduce(
      (s, a) => s + a.allocatedQty,
      0
    );
    if (totalAllocated + data.allocatedQty > roll.currentQty) {
      throw AppError.badRequest(
        `Yetersiz kapasite. Topta ${roll.currentQty}m var, ` +
          `${totalAllocated}m tahsis edilmiş, istenen ${data.allocatedQty}m`
      );
    }

    // Allocation create + sipariş status yeniden hesabı tek transaction'da
    const allocation = await prisma.$transaction(async (tx) => {
      const created = await tx.orderAllocation.create({
        data: {
          rollId: data.rollId,
          orderLineId: data.orderLineId,
          allocatedQty: data.allocatedQty,
        },
      });
      await recomputeOrderStatus(tx, orderLine.order.id);
      return created;
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ORDER_ALLOCATION",
      recordId: allocation.id,
      newData: {
        rollId: data.rollId,
        orderLineId: data.orderLineId,
        allocatedQty: data.allocatedQty,
        rollBarcode: roll.barcode,
        orderNumber: orderLine.order.orderNumber,
        customerName: orderLine.order.customer.name,
        source: "ALLOCATION_CENTER",
      },
    });

    return {
      success: true,
      data: {
        allocationId: allocation.id,
        rollBarcode: roll.barcode,
        orderNumber: orderLine.order.orderNumber,
        allocatedQty: data.allocatedQty,
      },
      message: `${data.allocatedQty}m ${orderLine.order.customer.name} siparişine tahsis edildi`,
    };
  }

  /**
   * Allocation'ı başka bir OrderLine'a taşır (Phase 2).
   *
   * Kullanım: Acil sipariş gelince, başka siparişe bağlı bir top o acil
   * siparişe yönlendirilir. Kaynak sipariş için "yeniden üretim borcu"
   * (ReproductionBacklog) kaydı oluşur — planlamacı borçtan haberdar olur.
   *
   * Kurallar:
   *   - Rol sevk edilmemiş olmalı (SHIPPED → reddedilir)
   *   - Müşteri-malı top (Roll.ownerCustomerId) sadece sahibinin siparişlerine
   *     taşınabilir (SERVICE_PRODUCTION koruması)
   *   - Hedef OrderLine'ın item/variant'i topa uymalı
   *   - Hedef sipariş açık olmalı (CANCELLED/COMPLETED kabul edilmez)
   *
   * Atomik: allocation güncellenir + backlog kaydı oluşur + iki sipariş'in
   * statüsü recompute edilir + audit log atılır.
   */
  async reassignAllocation(
    data: {
      allocationId: string;
      newOrderLineId: string;
      reason: string;
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!data.reason || data.reason.trim().length === 0) {
      throw AppError.badRequest("Taşıma nedeni (reason) zorunlu");
    }

    const existing = await prisma.orderAllocation.findUnique({
      where: { id: data.allocationId },
      include: {
        roll: true,
        orderLine: { include: { order: { select: { id: true, orderNumber: true, customerId: true } } } },
      },
    });
    if (!existing) throw AppError.notFound("Allocation bulunamadı");

    const oldOrderLine = existing.orderLine;
    const oldOrderId = oldOrderLine.order.id;

    if (oldOrderLine.id === data.newOrderLineId) {
      throw AppError.badRequest("Aynı sipariş satırına taşıma anlamsız");
    }

    // Sevk edilmiş rol → taşıma yapılamaz (allocation tamamen kilitli)
    const shippedQty = await prisma.shipmentItem.aggregate({
      where: { rollId: existing.rollId, shipment: { status: "SHIPPED" } },
      _sum: { shippedQty: true },
    });
    if ((shippedQty._sum.shippedQty ?? 0) > 0) {
      throw AppError.badRequest(
        `Top ${existing.roll.barcode} sevk edilmiş — allocation taşınamaz`
      );
    }

    const newOrderLine = await prisma.orderLine.findUnique({
      where: { id: data.newOrderLineId },
      include: { order: { include: { customer: true } } },
    });
    if (!newOrderLine) throw AppError.notFound("Hedef sipariş satırı bulunamadı");

    if (
      newOrderLine.order.status === OrderStatus.CANCELLED ||
      newOrderLine.order.status === OrderStatus.COMPLETED
    ) {
      throw AppError.badRequest(
        `Hedef sipariş kapalı (${newOrderLine.order.status}) — taşınamaz`
      );
    }

    // SERVICE_PRODUCTION koruması
    if (
      existing.roll.ownerCustomerId &&
      existing.roll.ownerCustomerId !== newOrderLine.order.customerId
    ) {
      throw AppError.badRequest(
        `Top ${existing.roll.barcode} müşteri-malı (SERVICE_PRODUCTION) — başka müşteriye taşınamaz`
      );
    }

    // Item / variant uyumu
    if (existing.roll.itemId !== newOrderLine.itemId) {
      throw AppError.badRequest("Top ürünü hedef sipariş satırı ürününe uymuyor");
    }
    if (newOrderLine.variantId && existing.roll.variantId !== newOrderLine.variantId) {
      throw AppError.badRequest(
        "Top varyantı hedef sipariş satırı varyantına uymuyor"
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // Allocation'ı yeni satıra taşı (in-place update — ID korunur, audit
      // izlenebilir kalır).
      const updated = await tx.orderAllocation.update({
        where: { id: data.allocationId },
        data: { orderLineId: data.newOrderLineId },
      });

      // Kaynak satır için yeniden üretim borcu kaydı.
      const backlog = await tx.reproductionBacklog.create({
        data: {
          orderLineId: oldOrderLine.id,
          qtyDeficit: existing.allocatedQty,
          reason: data.reason.trim(),
        },
      });

      // İki siparişi de recompute et (sevk durumları değişmemiş olsa da güvenli).
      await recomputeOrderStatus(tx, oldOrderId);
      await recomputeOrderStatus(tx, newOrderLine.order.id);

      return { updated, backlog };
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ORDER_ALLOCATION",
      recordId: data.allocationId,
      oldData: {
        orderLineId: oldOrderLine.id,
        orderId: oldOrderId,
        orderNumber: oldOrderLine.order.orderNumber,
        allocatedQty: existing.allocatedQty,
      },
      newData: {
        orderLineId: data.newOrderLineId,
        orderId: newOrderLine.order.id,
        orderNumber: newOrderLine.order.orderNumber,
        customerName: newOrderLine.order.customer.name,
        rollBarcode: existing.roll.barcode,
        allocatedQty: existing.allocatedQty,
        reason: data.reason.trim(),
        backlogId: result.backlog.id,
      },
    });

    return {
      success: true,
      data: {
        allocationId: data.allocationId,
        backlogId: result.backlog.id,
        rollBarcode: existing.roll.barcode,
        fromOrderNumber: oldOrderLine.order.orderNumber,
        toOrderNumber: newOrderLine.order.orderNumber,
        qty: existing.allocatedQty,
      },
      message:
        `Top ${existing.roll.barcode} ${oldOrderLine.order.orderNumber} → ` +
        `${newOrderLine.order.orderNumber} taşındı; ` +
        `${existing.allocatedQty}m yeniden üretim borcu açıldı`,
    };
  }

  /**
   * Bir hedef OrderLine için yeniden tahsis adayları (Phase 2).
   *
   * Aynı item (+variant) ve aynı müşteri-ya da-stok kuralına uyan, sevk
   * edilmemiş, mevcut allocation'ları listeler. Önceliklendirme: kaynak
   * siparişin termini ASC (en uzak terminden başla — onu çalmak daha güvenli).
   *
   * Döner: planlamacının seçim yapacağı liste. Otomatik taşıma YAPMAZ.
   */
  async getReassignSuggestions(
    targetOrderLineId: string
  ): Promise<ApiResponse<unknown>> {
    const target = await prisma.orderLine.findUnique({
      where: { id: targetOrderLineId },
      include: { order: { select: { id: true, customerId: true, deadline: true } } },
    });
    if (!target) throw AppError.notFound("Hedef sipariş satırı bulunamadı");

    const candidates = await prisma.orderAllocation.findMany({
      where: {
        orderLineId: { not: targetOrderLineId },
        roll: {
          itemId: target.itemId,
          // Variant uyumu — hedef variant istiyorsa, kaynak topun variant'ı eşleşmeli
          ...(target.variantId ? { variantId: target.variantId } : {}),
          // SERVICE_PRODUCTION: müşteri-malı top sadece sahibinin siparişine
          OR: [
            { ownerCustomerId: null },
            { ownerCustomerId: target.order.customerId },
          ],
          // Sevk edilmiş roll'u önerme
          shipmentItems: {
            none: { shipment: { status: "SHIPPED" } },
          },
        },
        orderLine: {
          order: {
            // Kapalı siparişlere bağlı allocation'ı önerme
            status: { notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] },
          },
        },
      },
      include: {
        roll: {
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            qualityGrade: true,
            status: true,
            ownerCustomerId: true,
            variant: { select: { id: true, code: true, name: true } },
          },
        },
        orderLine: {
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                deadline: true,
                customerId: true,
                customer: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    // Önceliklendirme: kaynak sipariş termini DESC (en uzak terminden başla
    // — o sipariş bekleyebilir). Termin null'ları en sona at.
    const sorted = candidates.sort((a, b) => {
      const aDl = a.orderLine.order.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
      const bDl = b.orderLine.order.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
      return bDl - aDl;
    });

    const targetDeadline = target.order.deadline?.getTime() ?? null;

    return {
      success: true,
      data: sorted.map((c) => ({
        allocationId: c.id,
        rollId: c.roll.id,
        rollBarcode: c.roll.barcode,
        rollQty: c.roll.currentQty,
        qualityGrade: c.roll.qualityGrade,
        rollStatus: c.roll.status,
        ownerCustomerId: c.roll.ownerCustomerId,
        variant: c.roll.variant,
        allocatedQty: c.allocatedQty,
        sourceOrderId: c.orderLine.order.id,
        sourceOrderNumber: c.orderLine.order.orderNumber,
        sourceOrderDeadline: c.orderLine.order.deadline,
        sourceCustomerName: c.orderLine.order.customer.name,
        // Hedefe göre öncelik sinyali: kaynak termini hedef termininden
        // ne kadar uzakta? (gün)
        deadlineSlackDays:
          targetDeadline != null && c.orderLine.order.deadline
            ? Math.round(
                (c.orderLine.order.deadline.getTime() - targetDeadline) /
                  (1000 * 60 * 60 * 24)
              )
            : null,
      })),
    };
  }
}

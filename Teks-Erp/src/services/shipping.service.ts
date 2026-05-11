// =============================================================================
// TeksERP - Shipping Service
// =============================================================================
// Handles packaging, shipment creation, flexible order reassignment,
// and stock deduction.
//
// CRITICAL BUSINESS RULES:
//   - Shipping dept sees orders (not work orders) in "ready" status.
//   - Goods reserved for Customer A can be reassigned to Customer B at shipment.
//   - When a shipment is finalized (SHIPPED), the system auto-checks:
//     If total shippedQty >= requestedQty → Order status → COMPLETED.
//     Otherwise → PARTIAL_SHIPPED.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import {
  Shipment,
  ShipmentStatus,
  RollStatus,
  OrderStatus,
  WorkOrderStatus,
  Prisma,
} from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { recomputeOrderStatus } from "./helpers/order-status.helper";
import {
  cursorWhere,
  buildNextCursor,
  decodeCursor,
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";


/**
 * İrsaliye snapshot'ı — finalize anında üretilir, sonsuza kadar saklanır.
 * Bu veri hem UI print dialog'una hem de PDF/HTML çıktısına doğrudan beslenir.
 * Snapshot'a girmeyen hiçbir canlı join ileride belgeyi değiştiremez.
 */
export interface ShipmentPrintSnapshot {
  version: 1;
  snapshotAt: string;
  shipment: {
    id: string;
    shipmentNumber: string;
    status: ShipmentStatus;
    shippedAt: string | null;
    createdAt: string;
    driverName: string | null;
    plateNumber: string | null;
    carrier: string | null;
  };
  customer: {
    id: string;
    code: string | null;
    name: string;
  };
  items: Array<{
    id: string;
    sequence: number;
    rollId: string;
    rollBarcode: string;
    itemCode: string;
    itemName: string;
    variantCode: string | null;
    variantName: string | null;
    customerLabel: string | null;
    customerCode: string | null;
    customerLabelSource: "ALIAS" | "ROLL_DESCRIPTION" | null;
    orderNumber: string | null;
    workOrderBatchNumber: string | null;
    workOrderType: string | null;
    shippedQty: number;
    shippedWeight: number | null;
  }>;
  totals: {
    itemCount: number;
    totalQty: number;
    totalWeight: number;
  };
}

/**
 * Bir sevkiyatın o anki tam görünümünü snapshot olarak üretir.
 * Transaction içinde veya dışında çağrılabilir.
 */
async function buildShipmentPrintSnapshot(
  tx: Prisma.TransactionClient | typeof prisma,
  shipmentId: string,
): Promise<ShipmentPrintSnapshot> {
  const shipment = await tx.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      customer: true,
      items: {
        include: {
          roll: {
            include: {
              item: true,
              variant: true,
              producedInStep: {
                select: {
                  workOrder: {
                    select: {
                      id: true,
                      batchNumber: true,
                      type: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!shipment) {
    throw AppError.notFound("Sevkiyat bulunamadı");
  }

  // Müşteri alias'larını toplu çek
  const variantIds = Array.from(
    new Set(
      shipment.items
        .map((i) => i.roll.variantId)
        .filter((v): v is string => !!v),
    ),
  );
  const aliasByVariantId = new Map<
    string,
    { customerLabel: string; customerCode: string | null }
  >();
  if (variantIds.length > 0) {
    const aliases = await tx.customerVariantAlias.findMany({
      where: {
        customerId: shipment.customerId,
        variantId: { in: variantIds },
        isActive: true,
      },
      select: { variantId: true, customerLabel: true, customerCode: true },
    });
    for (const a of aliases) {
      aliasByVariantId.set(a.variantId, {
        customerLabel: a.customerLabel,
        customerCode: a.customerCode,
      });
    }
  }

  const itemsSnapshot = shipment.items.map((item, idx) => {
    const alias = item.roll.variantId
      ? aliasByVariantId.get(item.roll.variantId) ?? null
      : null;

    // customerLabel önceliği: alias → roll.customerDescription → null
    let customerLabel: string | null = null;
    let customerCode: string | null = null;
    let source: "ALIAS" | "ROLL_DESCRIPTION" | null = null;
    if (alias) {
      customerLabel = alias.customerLabel;
      customerCode = alias.customerCode;
      source = "ALIAS";
    } else if (
      item.roll.customerDescription &&
      item.roll.customerDescription.trim().length > 0
    ) {
      customerLabel = item.roll.customerDescription;
      source = "ROLL_DESCRIPTION";
    }

    return {
      id: item.id,
      sequence: idx + 1,
      rollId: item.rollId,
      rollBarcode:
        item.rollBarcodeSnapshot ?? item.roll.barcode ?? "",
      itemCode: item.itemCodeSnapshot ?? item.roll.item.code ?? "",
      itemName: item.itemNameSnapshot ?? item.roll.item.name ?? "",
      variantCode: item.roll.variant?.code ?? null,
      variantName: item.roll.variant?.name ?? null,
      customerLabel,
      customerCode,
      customerLabelSource: source,
      orderNumber: item.orderNumberSnapshot ?? null,
      workOrderBatchNumber:
        item.roll.producedInStep?.workOrder?.batchNumber ?? null,
      workOrderType: item.roll.producedInStep?.workOrder?.type ?? null,
      shippedQty: item.shippedQty,
      shippedWeight: item.shippedWeight,
    };
  });

  const totalQty = itemsSnapshot.reduce((s, i) => s + i.shippedQty, 0);
  const totalWeight = itemsSnapshot.reduce(
    (s, i) => s + (i.shippedWeight ?? 0),
    0,
  );

  return {
    version: 1,
    snapshotAt: new Date().toISOString(),
    shipment: {
      id: shipment.id,
      shipmentNumber: shipment.shipmentNumber,
      status: shipment.status,
      shippedAt: shipment.shippedAt ? shipment.shippedAt.toISOString() : null,
      createdAt: shipment.createdAt.toISOString(),
      driverName: shipment.driverName,
      plateNumber: shipment.plateNumber,
      carrier: shipment.carrier,
    },
    customer: {
      id: shipment.customer.id,
      code:
        shipment.customerCodeSnapshot ?? shipment.customer.code ?? null,
      name:
        shipment.customerNameSnapshot ?? shipment.customer.name,
    },
    items: itemsSnapshot,
    totals: {
      itemCount: itemsSnapshot.length,
      totalQty,
      totalWeight,
    },
  };
}

/** Generate a unique shipment number */
function generateShipmentNumber(): string {
  const now = new Date();
  const datePart =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, "0") +
    now.getDate().toString().padStart(2, "0");
  const seq = uuidv4().replace(/-/g, "").substring(0, 6).toUpperCase();
  return `IRS-${datePart}-${seq}`;
}

/**
 * Bir siparişin statusunu kapsamlı olarak yeniden hesaplar (READY/SHORT/IN_PRODUCTION
 * + PARTIAL_SHIPPED/COMPLETED). Eski adı `recomputeOrderCompletion` idi; yerine
 * `recomputeOrderStatus` (helpers/order-status.helper) çağrılır. Çağrı kontratı korunur.
 *
 * Returns: { completed: boolean, orderNumber: string } | null
 */
async function recomputeOrderCompletion(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<{ completed: boolean; orderNumber: string } | null> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { orderNumber: true },
  });
  if (!order) return null;

  const result = await recomputeOrderStatus(tx, orderId);
  return {
    completed: result?.newStatus === OrderStatus.COMPLETED,
    orderNumber: order.orderNumber,
  };
}

export class ShippingService {
  /**
   * Get orders that are ready for shipment.
   * Business Rule: Shows orders that have allocated rolls in PRODUCED, READY_FOR_SHIP
   * veya A1_STOCK. WAREHOUSE statüsündeki toplar henüz tartı/paket'ten
   * geçmemiştir → sevkiyatta listelenmez.
   * Shipping dept does NOT see work orders.
   */
  async getReadyOrders(params?: {
    q?: string;
    customerId?: string;
    limit?: number;
    offset?: number;
    cursor?: string;
    mode?: "offset" | "cursor";
  }): Promise<
    | (ApiResponse<Record<string, unknown>[]> & {
        pagination: { total: number; limit: number; offset: number; hasMore: boolean };
      })
    | (ApiResponse<Record<string, unknown>[]> & {
        pagination: { nextCursor: string | null; hasMore: boolean; limit: number; totalEstimate?: number };
      })
  > {
    const limit = Math.min(100, Math.max(1, params?.limit ?? 50));
    const offset = Math.max(0, params?.offset ?? 0);
    const q = params?.q?.trim();
    const useCursor = params?.mode === "cursor" || !!params?.cursor;

    const searchOR: Prisma.OrderWhereInput[] | undefined = q
      ? [
          { orderNumber: { contains: q, mode: "insensitive" } },
          { customer: { name: { contains: q, mode: "insensitive" } } },
        ]
      : undefined;

    const baseWhere: Prisma.OrderWhereInput = {
      status: {
        notIn: [OrderStatus.PENDING, OrderStatus.COMPLETED, OrderStatus.CANCELLED],
      },
      lines: {
        some: {
          allocations: {
            some: {
              roll: {
                status: {
                  in: [RollStatus.PRODUCED, RollStatus.READY_FOR_SHIP, RollStatus.A1_STOCK],
                },
              },
            },
          },
        },
      },
      ...(params?.customerId ? { customerId: params.customerId } : {}),
      ...(searchOR ? { OR: searchOR } : {}),
    };

    const cursor = params?.cursor ? decodeCursor(params.cursor) : null;
    const where: Prisma.OrderWhereInput = useCursor && cursor
      ? { AND: [baseWhere, cursorWhere(cursor)] }
      : baseWhere;

    const orderSelect = {
      id: true,
      orderNumber: true,
      customerId: true,
      branchId: true,
      status: true,
      deadline: true,
      orderDate: true,
      currency: true,
      totalAmount: true,
      createdAt: true,
      customer: { select: { id: true, code: true, name: true } },
      branch: { select: { id: true, name: true, city: true, district: true } },
      lines: {
        select: {
          id: true,
          quantity: true,
          width: true,
          unitPrice: true,
          item: {
            select: {
              id: true,
              name: true,
              code: true,
              color: { select: { id: true, code: true, name: true, hex: true } },
            },
          },
          variant: { select: { id: true, code: true, name: true } },
          allocations: {
            select: {
              id: true,
              rollId: true,
              allocatedQty: true,
              roll: {
                select: {
                  id: true,
                  barcode: true,
                  status: true,
                  packageId: true,
                  currentQty: true,
                  weightKg: true,
                  width: true,
                  qualityGrade: true,
                },
              },
            },
          },
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

    const readyOrders = orders.map((order) => ({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customer.name,
      customerId: order.customerId,
      branchId: order.branchId,
      branch: order.branch
        ? {
            id: order.branch.id,
            name: order.branch.name,
            city: order.branch.city,
            district: order.branch.district,
          }
        : null,
      status: order.status,
      orderDate: order.orderDate,
      deadline: order.deadline,
      currency: order.currency,
      totalAmount: order.totalAmount ? String(order.totalAmount) : null,
      lines: order.lines.map((line) => ({
        lineId: line.id,
        itemCode: line.item.code,
        itemName: line.item.name,
        color: line.item.color
          ? {
              id: line.item.color.id,
              code: line.item.color.code,
              name: line.item.color.name,
              hex: line.item.color.hex,
            }
          : null,
        variant: line.variant
          ? { id: line.variant.id, code: line.variant.code, name: line.variant.name }
          : null,
        width: line.width,
        unitPrice: line.unitPrice ? String(line.unitPrice) : null,
        requestedQty: line.quantity,
        allocatedRolls: line.allocations
          .filter(
            (a) =>
              a.roll.status === RollStatus.PRODUCED ||
              a.roll.status === RollStatus.READY_FOR_SHIP ||
              a.roll.status === RollStatus.A1_STOCK,
          )
          .map((a) => ({
            allocationId: a.id,
            rollId: a.rollId,
            barcode: a.roll.barcode,
            allocatedQty: a.allocatedQty,
            rollStatus: a.roll.status,
            packageId: a.roll.packageId,
            currentQty: a.roll.currentQty,
            weightKg: a.roll.weightKg,
            width: a.roll.width,
            qualityGrade: a.roll.qualityGrade,
          })),
      })),
    }));

    if (useCursor) {
      const last = orders[orders.length - 1] as
        | { id: string; createdAt: Date }
        | undefined;
      const nextCursor = hasMoreCursor && last ? buildNextCursor(last) : null;
      return {
        success: true,
        data: readyOrders,
        pagination: { nextCursor, hasMore: hasMoreCursor, limit, totalEstimate: total },
      };
    }

    return {
      success: true,
      data: readyOrders,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + orders.length < total,
      },
    };
  }

  /**
   * Sevke hazır fason (müşteri-malı) toplar.
   * Business Rule: `ownerCustomerId` dolu + `READY_FOR_SHIP` / `PRODUCED` / `A1_STOCK` +
   * başka bir sevkiyata eklenmemiş toplar. Müşteriye göre gruplanır.
   */
  async getReadyFasonRolls(): Promise<
    ApiResponse<
      Array<{
        customerId: string;
        customerName: string;
        rolls: Array<{
          rollId: string;
          barcode: string;
          itemCode: string;
          itemName: string;
          variantCode: string | null;
          variantName: string | null;
          currentQty: number;
          weightKg: number | null;
          width: number | null;
          qualityGrade: string;
          status: RollStatus;
          packagingDate: Date | null;
        }>;
      }>
    >
  > {
    const rolls = await prisma.roll.findMany({
      where: {
        ownerCustomerId: { not: null },
        status: {
          in: [
            RollStatus.PRODUCED,
            RollStatus.READY_FOR_SHIP,
            RollStatus.A1_STOCK,
          ],
        },
        shipmentItems: { none: {} },
      },
      include: {
        item: { select: { code: true, name: true } },
        variant: { select: { code: true, name: true } },
        ownerCustomer: { select: { id: true, name: true } },
      },
      orderBy: { packagingDate: "desc" },
    });

    const groups = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        rolls: Array<{
          rollId: string;
          barcode: string;
          itemCode: string;
          itemName: string;
          variantCode: string | null;
          variantName: string | null;
          currentQty: number;
          weightKg: number | null;
          width: number | null;
          qualityGrade: string;
          status: RollStatus;
          packagingDate: Date | null;
        }>;
      }
    >();

    for (const roll of rolls) {
      if (!roll.ownerCustomer) continue;
      const key = roll.ownerCustomer.id;
      if (!groups.has(key)) {
        groups.set(key, {
          customerId: roll.ownerCustomer.id,
          customerName: roll.ownerCustomer.name,
          rolls: [],
        });
      }
      groups.get(key)!.rolls.push({
        rollId: roll.id,
        barcode: roll.barcode,
        itemCode: roll.item.code,
        itemName: roll.item.name,
        variantCode: roll.variant?.code ?? null,
        variantName: roll.variant?.name ?? null,
        currentQty: roll.currentQty,
        weightKg: roll.weightKg,
        width: roll.width,
        qualityGrade: roll.qualityGrade,
        status: roll.status,
        packagingDate: roll.packagingDate,
      });
    }

    return { success: true, data: Array.from(groups.values()) };
  }

  /**
   * Paketleme finalize'inde plannedOrder vardı ama satır ataması yapılmadan
   * READY_FOR_SHIP'e geçmiş "hayalet" toplar. Sipariş satırı belirsizliği
   * (aynı item için birden fazla satır) durumunda eski sürümde sessizce
   * oluşurdu. Recovery için DONE kuyruk satırından planlı siparişi okuyup
   * operatöre seçtirebileceğimiz adayları döner.
   */
  async getOrphanReadyRolls(): Promise<
    ApiResponse<
      Array<{
        rollId: string;
        barcode: string;
        itemId: string;
        itemCode: string;
        itemName: string;
        variantCode: string | null;
        variantName: string | null;
        currentQty: number;
        weightKg: number | null;
        width: number | null;
        qualityGrade: string;
        packagingDate: Date | null;
        plannedOrder: {
          orderId: string;
          orderNumber: string;
          customerName: string;
          deadline: Date | null;
          status: OrderStatus;
          lines: Array<{
            lineId: string;
            itemId: string;
            itemCode: string;
            itemName: string;
            requestedQty: number;
            width: number | null;
            variantName: string | null;
            colorName: string | null;
          }>;
        } | null;
      }>
    >
  > {
    const rolls = await prisma.roll.findMany({
      where: {
        status: RollStatus.READY_FOR_SHIP,
        ownerCustomerId: null,
        allocations: { none: {} },
        shipmentItems: { none: {} },
      },
      select: {
        id: true,
        barcode: true,
        itemId: true,
        currentQty: true,
        weightKg: true,
        width: true,
        qualityGrade: true,
        packagingDate: true,
        item: { select: { code: true, name: true } },
        variant: { select: { code: true, name: true } },
        packagingQueueEntries: {
          where: { status: "DONE", plannedOrderId: { not: null } },
          orderBy: { completedAt: "desc" },
          take: 1,
          select: {
            plannedOrder: {
              select: {
                id: true,
                orderNumber: true,
                status: true,
                deadline: true,
                customer: { select: { name: true } },
                lines: {
                  select: {
                    id: true,
                    itemId: true,
                    quantity: true,
                    width: true,
                    item: {
                      select: {
                        code: true,
                        name: true,
                        color: { select: { name: true } },
                      },
                    },
                    variant: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { packagingDate: "desc" },
      take: 200,
    });

    const data = rolls.map((roll) => {
      const planned = roll.packagingQueueEntries[0]?.plannedOrder ?? null;
      return {
        rollId: roll.id,
        barcode: roll.barcode,
        itemId: roll.itemId,
        itemCode: roll.item.code,
        itemName: roll.item.name,
        variantCode: roll.variant?.code ?? null,
        variantName: roll.variant?.name ?? null,
        currentQty: roll.currentQty,
        weightKg: roll.weightKg,
        width: roll.width,
        qualityGrade: roll.qualityGrade,
        packagingDate: roll.packagingDate,
        plannedOrder: planned
          ? {
              orderId: planned.id,
              orderNumber: planned.orderNumber,
              customerName: planned.customer.name,
              deadline: planned.deadline,
              status: planned.status,
              lines: planned.lines.map((l) => ({
                lineId: l.id,
                itemId: l.itemId,
                itemCode: l.item.code,
                itemName: l.item.name,
                requestedQty: l.quantity,
                width: l.width,
                variantName: l.variant?.name ?? null,
                colorName: l.item.color?.name ?? null,
              })),
            }
          : null,
      };
    });

    return { success: true, data };
  }

  /**
   * Hayalet topu sipariş satırına bağlar — paketleme finalize'i sırasında
   * yapılması gereken allocation'ı sonradan kurmak için.
   */
  async assignOrphanRollToOrderLine(
    rollId: string,
    orderLineId: string,
    userId: string | undefined
  ): Promise<ApiResponse<{ rollId: string; orderLineId: string }>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: {
        id: true,
        status: true,
        itemId: true,
        currentQty: true,
        ownerCustomerId: true,
        allocations: { select: { id: true } },
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.status !== RollStatus.READY_FOR_SHIP) {
      throw AppError.badRequest(
        `Top READY_FOR_SHIP durumunda değil (mevcut: ${roll.status})`
      );
    }
    if (roll.ownerCustomerId) {
      throw AppError.badRequest("Fason (müşteri-malı) top siparişe bağlanamaz");
    }
    if (roll.allocations.length > 0) {
      throw AppError.conflict("Top zaten bir sipariş satırına bağlı");
    }

    const line = await prisma.orderLine.findUnique({
      where: { id: orderLineId },
      select: {
        id: true,
        itemId: true,
        order: { select: { id: true, orderNumber: true, status: true } },
      },
    });
    if (!line) throw AppError.notFound("Sipariş satırı bulunamadı");
    if (line.itemId !== roll.itemId) {
      throw AppError.badRequest(
        "Sipariş satırı ile topun ürünü eşleşmiyor"
      );
    }
    if (
      line.order.status === OrderStatus.CANCELLED ||
      line.order.status === OrderStatus.COMPLETED
    ) {
      throw AppError.badRequest(
        `Sipariş durumu uygun değil (${line.order.status})`
      );
    }

    await prisma.orderAllocation.create({
      data: {
        rollId,
        orderLineId,
        allocatedQty: roll.currentQty,
      },
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "OrderAllocation",
      recordId: rollId,
      newData: {
        rollId,
        orderLineId,
        orderNumber: line.order.orderNumber,
        allocatedQty: roll.currentQty,
        reason: "orphan-recovery",
      },
    });

    return {
      success: true,
      data: { rollId, orderLineId },
      message: `Top ${line.order.orderNumber} siparişine bağlandı`,
    };
  }

  /**
   * Prepare package: assign rolls to a package (sack/palette).
   * Updates rolls with packageId, grossWeightKg, and READY_FOR_SHIP status.
   */
  async preparePackage(
    data: {
      rollIds: string[];
      packageId: string;
      grossWeightKg: number;
    },
    userId?: string
  ): Promise<ApiResponse<{ packaged: number }>> {
    let packaged = 0;

    await prisma.$transaction(async (tx) => {
      for (const rollId of data.rollIds) {
        const roll = await tx.roll.findUnique({ where: { id: rollId } });
        if (!roll) continue;

        if (roll.status !== RollStatus.PRODUCED && roll.status !== RollStatus.A1_STOCK) {
          continue; // Sadece PRODUCED veya A1_STOCK paketlenebilir
        }

        await tx.roll.update({
          where: { id: rollId },
          data: {
            packageId: data.packageId,
            grossWeightKg: data.grossWeightKg,
            packagingDate: new Date(),
            status: RollStatus.READY_FOR_SHIP,
          },
        });

        packaged++;
      }
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: data.packageId,
      newData: {
        packageId: data.packageId,
        rollCount: packaged,
        grossWeightKg: data.grossWeightKg,
      },
    });

    return {
      success: true,
      data: { packaged },
      message: `${packaged} top paketlendi. Paket: ${data.packageId}`,
    };
  }

  /**
   * Create a new shipment container.
   */
  async createShipment(
    data: {
      customerId: string;
      branchId?: string | null;
      driverName?: string;
      plateNumber?: string;
      carrier?: string;
      priority?: number;
      plannedDate?: string | null;
      plannedOrderIds?: string[]; // Planlamacı sevkiyatı oluştururken siparişleri de seçer
    },
    userId?: string
  ): Promise<ApiResponse<Shipment>> {
    // Verify customer
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
    });
    if (!customer) {
      throw AppError.notFound("Müşteri bulunamadı");
    }

    // Verify branch (if provided) and check it belongs to the customer
    let branchNameSnapshot: string | null = null;
    if (data.branchId) {
      const branch = await prisma.customerBranch.findUnique({
        where: { id: data.branchId },
        select: { id: true, name: true, customerId: true, isActive: true },
      });
      if (!branch) throw AppError.notFound("Şube bulunamadı");
      if (branch.customerId !== data.customerId) {
        throw AppError.badRequest("Şube bu müşteriye ait değil");
      }
      if (!branch.isActive) throw AppError.badRequest("Şube pasif durumda");
      branchNameSnapshot = branch.name;
    }

    // Planlanan siparişler (varsa) — hepsi aynı müşteriye ait olmalı.
    if (data.plannedOrderIds && data.plannedOrderIds.length > 0) {
      const orders = await prisma.order.findMany({
        where: { id: { in: data.plannedOrderIds } },
        select: { id: true, customerId: true, status: true, orderNumber: true },
      });
      if (orders.length !== data.plannedOrderIds.length) {
        throw AppError.notFound("Planlanan siparişlerden biri bulunamadı");
      }
      const wrongCustomer = orders.find((o) => o.customerId !== data.customerId);
      if (wrongCustomer) {
        throw AppError.badRequest(
          `Sipariş ${wrongCustomer.orderNumber} bu müşteriye ait değil`
        );
      }
      const closed = orders.find(
        (o) => o.status === "COMPLETED" || o.status === "CANCELLED"
      );
      if (closed) {
        throw AppError.badRequest(
          `Sipariş ${closed.orderNumber} kapanmış (${closed.status}) — sevkiyat planına eklenemez`
        );
      }
    }

    const shipment = await prisma.$transaction(async (tx) => {
      const created = await tx.shipment.create({
        data: {
          shipmentNumber: generateShipmentNumber(),
          customerId: data.customerId,
          branchId: data.branchId ?? null,
          driverName: data.driverName ?? null,
          plateNumber: data.plateNumber ?? null,
          carrier: data.carrier ?? null,
          status: ShipmentStatus.PREPARING,
          priority: data.priority ?? 0,
          plannedDate: data.plannedDate ? new Date(data.plannedDate) : null,
          customerCodeSnapshot: customer.code,
          customerNameSnapshot: customer.name,
          branchNameSnapshot,
        },
        include: { customer: true, branch: true },
      });

      if (data.plannedOrderIds && data.plannedOrderIds.length > 0 && userId) {
        // Sıralama planlamacının verdiği sırayla
        for (let i = 0; i < data.plannedOrderIds.length; i++) {
          await tx.shipmentPlannedOrder.create({
            data: {
              shipmentId: created.id,
              orderId: data.plannedOrderIds[i],
              sortOrder: i,
              addedByUserId: userId,
            },
          });
        }
      }

      return created;
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SHIPMENT",
      recordId: shipment.id,
      newData: {
        shipmentNumber: shipment.shipmentNumber,
        customerId: data.customerId,
        customerName: customer.name,
        branchId: data.branchId ?? null,
        branchName: branchNameSnapshot,
      },
    });

    return {
      success: true,
      data: shipment,
      message: `Sevkiyat oluşturuldu: ${shipment.shipmentNumber}`,
    };
  }

  // =========================================================================
  // PLANLAMA AKIŞI — planlamacı (allocation:write) tarafından çağrılır
  // =========================================================================

  /**
   * Sevkiyatın priority/plannedDate alanlarını günceller (planlamacı sıralaması).
   * Sadece PREPARING durumunda. SHIPPED bir sevkiyatın planını değiştirmiyoruz.
   */
  async updateShipmentPlan(
    id: string,
    data: { priority?: number; plannedDate?: string | null },
    userId?: string
  ): Promise<ApiResponse<Shipment>> {
    if (!userId) throw AppError.unauthorized();
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      select: { id: true, status: true, priority: true, plannedDate: true },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.badRequest(
        "Sadece hazırlıktaki (PREPARING) sevkiyatlar planlanabilir"
      );
    }

    const updated = await prisma.shipment.update({
      where: { id },
      data: {
        priority: data.priority,
        plannedDate:
          data.plannedDate === undefined
            ? undefined
            : data.plannedDate === null
              ? null
              : new Date(data.plannedDate),
      },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: id,
      oldData: {
        priority: shipment.priority,
        plannedDate: shipment.plannedDate,
      },
      newData: {
        priority: updated.priority,
        plannedDate: updated.plannedDate,
      },
    });

    return { success: true, data: updated, message: "Sevkiyat planı güncellendi" };
  }

  /**
   * Sevkiyat planına sipariş ekle. Aynı müşteriye ait olmalı, kapanmamış olmalı.
   */
  async addOrderToShipmentPlan(
    shipmentId: string,
    orderId: string,
    note: string | undefined,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();

    const [shipment, order] = await Promise.all([
      prisma.shipment.findUnique({
        where: { id: shipmentId },
        select: { id: true, status: true, customerId: true, shipmentNumber: true },
      }),
      prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, customerId: true, status: true, orderNumber: true },
      }),
    ]);
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (!order) throw AppError.notFound("Sipariş bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.badRequest("Sadece PREPARING sevkiyatın planı düzenlenebilir");
    }
    if (order.customerId !== shipment.customerId) {
      throw AppError.badRequest("Sipariş bu sevkiyatın müşterisine ait değil");
    }
    if (order.status === "COMPLETED" || order.status === "CANCELLED") {
      throw AppError.badRequest(
        `Sipariş kapalı (${order.status}) — sevkiyat planına eklenemez`
      );
    }

    const existing = await prisma.shipmentPlannedOrder.findUnique({
      where: { shipmentId_orderId: { shipmentId, orderId } },
      select: { id: true },
    });
    if (existing) throw AppError.conflict("Sipariş zaten bu sevkiyatın planında");

    // sortOrder = mevcut max + 1
    const last = await prisma.shipmentPlannedOrder.aggregate({
      where: { shipmentId },
      _max: { sortOrder: true },
    });
    const sortOrder = (last._max.sortOrder ?? -1) + 1;

    const created = await prisma.shipmentPlannedOrder.create({
      data: {
        shipmentId,
        orderId,
        sortOrder,
        note: note ?? null,
        addedByUserId: userId,
      },
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SHIPMENT_PLANNED_ORDER",
      recordId: created.id,
      newData: {
        shipmentNumber: shipment.shipmentNumber,
        orderNumber: order.orderNumber,
      },
    });

    return { success: true, data: created, message: "Plana eklendi" };
  }

  /**
   * Sevkiyat planından sipariş çıkar.
   */
  async removeOrderFromShipmentPlan(
    plannedOrderId: string,
    userId?: string
  ): Promise<ApiResponse<{ id: string }>> {
    if (!userId) throw AppError.unauthorized();

    const existing = await prisma.shipmentPlannedOrder.findUnique({
      where: { id: plannedOrderId },
      select: {
        id: true,
        shipmentId: true,
        orderId: true,
        shipment: { select: { status: true } },
      },
    });
    if (!existing) throw AppError.notFound("Planlama kaydı bulunamadı");
    if (existing.shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.badRequest("Sevkiyat hazırlıktan çıkmış — plan düzenlenemez");
    }

    await prisma.shipmentPlannedOrder.delete({ where: { id: plannedOrderId } });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "SHIPMENT_PLANNED_ORDER",
      recordId: plannedOrderId,
      oldData: { shipmentId: existing.shipmentId, orderId: existing.orderId },
    });

    return { success: true, data: { id: plannedOrderId }, message: "Plandan çıkarıldı" };
  }

  /**
   * Add rolls to a shipment.
   *
   * CRITICAL BUSINESS RULE (Flexible Reassignment):
   * If a roll was allocated to a different customer's order, the old allocation
   * is detached and the roll is reassigned to the shipment's customer.
   */
  /**
   * Bir çuvalı sevkiyata ekle.
   *  - Sack.shipmentId set edilir (PREPARING aşamasında)
   *  - Çuvalın içindeki Roll'lar için ShipmentItem oluşturulur (addItemsToShipment ile)
   *  - Müşteri uyumu zorunlu (sack.customerId === shipment.customerId)
   */
  async addSackToShipment(
    data: { shipmentId: string; sackId: string },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: data.shipmentId },
      select: { id: true, status: true, customerId: true, shipmentNumber: true },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict(
        `Bu sevkiyata çuval eklenemez (durum: ${shipment.status})`
      );
    }

    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: {
        id: true,
        sackNumber: true,
        customerId: true,
        shipmentId: true,
        rolls: { select: { id: true } },
      },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.customerId !== shipment.customerId) {
      throw AppError.badRequest(
        "Çuvalın müşterisi bu sevkiyatın müşterisinden farklı"
      );
    }
    if (sack.shipmentId && sack.shipmentId !== data.shipmentId) {
      throw AppError.conflict(
        "Çuval başka bir sevkiyatta — önce oradan çıkarın"
      );
    }
    if (sack.rolls.length === 0) {
      throw AppError.badRequest("Boş çuval sevkiyata eklenemez");
    }

    // Sack.shipmentId set
    await prisma.sack.update({
      where: { id: data.sackId },
      data: { shipmentId: data.shipmentId },
    });

    // İçindeki rollar için ShipmentItem oluştur (addItemsToShipment idempotent olmalı —
    // alreadyInShipment durumunu zaten ele alıyor)
    const result = await this.addItemsToShipment(
      data.shipmentId,
      sack.rolls.map((r) => r.id),
      userId
    );

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SACK_SHIPMENT_ASSIGN",
      recordId: data.sackId,
      newData: {
        sackNumber: sack.sackNumber,
        shipmentId: data.shipmentId,
        shipmentNumber: shipment.shipmentNumber,
        rollsAdded: result.data?.added ?? 0,
      },
    });

    return {
      success: true,
      data: { sackId: data.sackId, ...result.data },
      message: `Çuval ${sack.sackNumber} sevkiyata eklendi`,
    };
  }

  /**
   * Bir çuvalı sevkiyattan çıkar.
   *  - Sack.shipmentId null
   *  - Çuvaldaki Roll'ların ShipmentItem'ları bu sevkiyattan silinir
   *  - Sadece PREPARING aşamasındaki sevkiyatlardan çıkarılabilir
   */
  async removeSackFromShipment(
    data: { shipmentId: string; sackId: string },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: data.shipmentId },
      select: { status: true, shipmentNumber: true },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict(
        `Sevkiyat finalize edilmiş — çuval çıkarılamaz`
      );
    }

    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: {
        id: true,
        sackNumber: true,
        shipmentId: true,
        rolls: { select: { id: true } },
      },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId !== data.shipmentId) {
      throw AppError.badRequest("Çuval bu sevkiyatta değil");
    }

    await prisma.$transaction(async (tx) => {
      // ShipmentItem'ları sil (sadece bu sevkiyat × bu sack'in roll'ları)
      await tx.shipmentItem.deleteMany({
        where: {
          shipmentId: data.shipmentId,
          rollId: { in: sack.rolls.map((r) => r.id) },
        },
      });
      await tx.sack.update({
        where: { id: data.sackId },
        data: { shipmentId: null },
      });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SACK_SHIPMENT_ASSIGN",
      recordId: data.sackId,
      newData: {
        sackNumber: sack.sackNumber,
        removedFromShipment: shipment.shipmentNumber,
      },
    });

    return {
      success: true,
      data: { sackId: data.sackId, removedFromShipment: shipment.shipmentNumber },
      message: `Çuval ${sack.sackNumber} sevkiyattan çıkarıldı`,
    };
  }

  async addItemsToShipment(
    shipmentId: string,
    rollIds: string[],
    userId?: string
  ): Promise<
    ApiResponse<{
      added: number;
      reassigned: number;
      notFound: number;
      ownerMismatch: number;
      wrongStatus: number;
      alreadyInShipment: number;
      swatchesSkipped: number;
    }>
  > {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: { customer: true },
    });

    if (!shipment) {
      throw AppError.notFound("Sevkiyat bulunamadı");
    }

    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.badRequest("Sevkiyat PREPARING durumunda değil. Ürün eklenemez.");
    }

    let added = 0;
    let reassigned = 0;
    let notFound = 0;
    let ownerMismatch = 0;
    let wrongStatus = 0;
    let alreadyInShipment = 0;
    let swatchesSkipped = 0;

    await prisma.$transaction(async (tx) => {
      for (const identifier of rollIds) {
        // Kartela barkodları (SW-) top değildir — sessizce geç, notFound'a düşürme.
        if (identifier.startsWith("SW-")) {
          swatchesSkipped++;
          continue;
        }

        // Barkod veya UUID — her ikisini de destekle
        const roll = await tx.roll.findFirst({
          where: {
            OR: [{ id: identifier }, { barcode: identifier }],
          },
          include: {
            item: true,
            allocations: { include: { orderLine: { include: { order: true } } } },
          },
        });

        if (!roll) {
          notFound++;
          continue;
        }

        if (
          roll.status !== RollStatus.PRODUCED &&
          roll.status !== RollStatus.READY_FOR_SHIP &&
          roll.status !== RollStatus.A1_STOCK
        ) {
          wrongStatus++;
          continue;
        }

        // Fason Üretim Kabul: müşteri-malı top sadece sahibine sevk edilebilir.
        if (roll.ownerCustomerId && roll.ownerCustomerId !== shipment.customerId) {
          ownerMismatch++;
          continue;
        }

        // Check if roll is already in another shipment
        const existingItem = await tx.shipmentItem.findUnique({
          where: { rollId: roll.id },
        });
        if (existingItem) {
          alreadyInShipment++;
          continue;
        }

        // Flexible Reassignment: check if allocation is for a different customer
        // Snapshot: sevkiyat müşterisine ait kalan allocation'ın sipariş numarasını sakla
        let orderNumberSnapshot: string | null = null;
        for (const allocation of roll.allocations) {
          if (allocation.orderLine.order.customerId !== shipment.customerId) {
            // Detach old allocation
            await tx.orderAllocation.delete({
              where: { id: allocation.id },
            });
            reassigned++;

            await AuditService.log({
              userId,
              action: "DELETE",
              tableName: "ORDER_ALLOCATION",
              recordId: allocation.id,
              oldData: {
                rollId: roll.id,
                orderNumber: allocation.orderLine.order.orderNumber,
                reason: "REASSIGNED_TO_DIFFERENT_CUSTOMER",
              },
            });
          } else if (!orderNumberSnapshot) {
            orderNumberSnapshot = allocation.orderLine.order.orderNumber;
          }
        }

        // Add to shipment
        await tx.shipmentItem.create({
          data: {
            shipmentId,
            rollId: roll.id,
            shippedQty: roll.currentQty,
            shippedWeight: roll.weightKg,
            rollBarcodeSnapshot: roll.barcode,
            itemCodeSnapshot: roll.item.code,
            itemNameSnapshot: roll.item.name,
            orderNumberSnapshot,
          },
        });

        added++;
      }
    });

    const messages = [`${added} top sevkiyata eklendi`];
    if (reassigned > 0) messages.push(`${reassigned} top yeniden atandı`);
    if (notFound > 0) messages.push(`${notFound} barkod/ID bulunamadı`);
    if (wrongStatus > 0)
      messages.push(
        `${wrongStatus} top sevke hazır değil (durum: paketlenmemiş veya sevk edilmiş)`
      );
    if (alreadyInShipment > 0)
      messages.push(`${alreadyInShipment} top zaten başka bir irsaliyede`);
    if (ownerMismatch > 0)
      messages.push(
        `${ownerMismatch} top müşteri malı, başka müşteriye sevk edilemez`
      );
    if (swatchesSkipped > 0)
      messages.push(`${swatchesSkipped} kartela numunesi atlandı (top olarak kaydedilmez)`);

    return {
      success: true,
      data: {
        added,
        reassigned,
        notFound,
        ownerMismatch,
        wrongStatus,
        alreadyInShipment,
        swatchesSkipped,
      },
      message: messages.join(". ") + ".",
    };
  }

  /**
   * Finalize shipment: set to SHIPPED, update rolls, and auto-check order completion.
   *
   * CRITICAL BUSINESS RULE (Order Completion Trigger):
   * For every order affected, calculate total shippedQty.
   * If shippedQty >= requested quantity → Order → COMPLETED.
   * Otherwise → PARTIAL_SHIPPED.
   */
  async finalizeShipment(
    shipmentId: string,
    userId?: string
  ): Promise<
    ApiResponse<{
      shipment: Shipment;
      rollupdated: number;
      ordersCompleted: string[];
      ordersPartial: string[];
      workOrdersCompleted: string[];
    }>
  > {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        items: {
          include: {
            roll: {
              include: {
                allocations: {
                  include: {
                    orderLine: {
                      include: { order: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!shipment) {
      throw AppError.notFound("Sevkiyat bulunamadı");
    }

    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.badRequest("Sevkiyat zaten finalize edilmiş");
    }

    if (shipment.items.length === 0) {
      throw AppError.badRequest("Sevkiyatta ürün yok. Önce ürün ekleyin.");
    }

    const ordersCompleted: string[] = [];
    const ordersPartial: string[] = [];
    const workOrdersCompleted: string[] = [];
    const affectedOrderIds = new Set<string>();
    const affectedStepIds = new Set<string>();

    const updatedShipment = await prisma.$transaction(async (tx) => {
      // 0. Yazdırma snapshot'ı — irsaliye verisinin tam kopyası, status güncellenmeden
      //    önce build edilir; içindeki status alanı zaten SHIPPED olacak şekilde set
      //    edileceği için aşağıdaki update'ten SONRA tekrar set edilemez —
      //    bu yüzden data'yı şimdi topla, sonra override et.
      const preSnapshot = await buildShipmentPrintSnapshot(tx, shipmentId);
      const printSnapshot: ShipmentPrintSnapshot = {
        ...preSnapshot,
        shipment: {
          ...preSnapshot.shipment,
          status: ShipmentStatus.SHIPPED,
          shippedAt: new Date().toISOString(),
        },
      };

      // 1. Update shipment status + snapshot'ı dondur
      const updated = await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          status: ShipmentStatus.SHIPPED,
          shippedAt: new Date(),
          shippedById: userId ?? null,
          printSnapshot: printSnapshot as unknown as Prisma.InputJsonValue,
        },
        include: { customer: true },
      });

      // 2. Toplu roll status güncellemesi — N round-trip yerine 1.
      //    Etkilenen sipariş ve step'leri toplama tx dışındaki shipment.items
      //    snapshot'ından yapılır (tx içine alacak ek sorgu yok).
      const rollIds: string[] = [];
      for (const item of shipment.items) {
        rollIds.push(item.rollId);
        for (const allocation of item.roll.allocations) {
          affectedOrderIds.add(allocation.orderLine.orderId);
        }
        if (item.roll.producedInStepId) affectedStepIds.add(item.roll.producedInStepId);
        if (item.roll.currentStepId) affectedStepIds.add(item.roll.currentStepId);
      }
      await tx.roll.updateMany({
        where: { id: { in: rollIds } },
        data: { status: RollStatus.SHIPPED },
      });

      // 2b. Bu sevkiyata bağlı çuvalları "sevk edildi" olarak işaretle.
      // (Sack.shipmentId zaten dolu; shippedAt + içindeki kartelaların izlenmesi için.)
      await tx.sack.updateMany({
        where: { shipmentId },
        data: { shippedAt: new Date() },
      });

      // 3. Auto-check order completion (helper'a delege — bindShipmentToOrders ile aynı mantık)
      for (const orderId of affectedOrderIds) {
        const result = await recomputeOrderCompletion(tx, orderId);
        if (!result) continue;
        if (result.completed) {
          ordersCompleted.push(result.orderNumber);
        } else {
          ordersPartial.push(result.orderNumber);
        }
      }

      // 4. Auto-check work order completion.
      //    Bir WO'ya bağlı tüm toplar terminal duruma (SHIPPED/SCRAP/A1_STOCK/
      //    RETURNED_FROM_SUBCONTRACTOR) ulaştıysa WO.status = COMPLETED.
      //    ORDER_PRODUCTION / STOCK_PRODUCTION / SERVICE_PRODUCTION / REPAIR_REWORK
      //    tiplerinin hepsi bu yoldan geçer.
      // Etkilenen WO'ları tek findMany ile toplu çek; sonra TÜM WO step'lerine
      // dair aktif roll var mı kontrolünü TEK bir findMany ile yap.
      // Önceki pattern: WO başına 2 query (findUnique + count) → N=20 için 40 query.
      // Yeni: 3 sabit query (stepWO, WOs, activeRolls) + 2 toplu update.
      const stepWorkOrders = await tx.workOrderStep.findMany({
        where: { id: { in: Array.from(affectedStepIds) } },
        select: { workOrderId: true },
      });
      const affectedWorkOrderIds = Array.from(
        new Set(stepWorkOrders.map((s) => s.workOrderId))
      );

      const ACTIVE_ROLL_STATUSES: RollStatus[] = [
        RollStatus.STOCK,
        RollStatus.IN_PRODUCTION,
        RollStatus.PRODUCED,
        RollStatus.READY_FOR_SHIP,
        RollStatus.AT_SUBCONTRACTOR,
        RollStatus.WAREHOUSE,
      ];

      if (affectedWorkOrderIds.length > 0) {
        const wos = await tx.workOrder.findMany({
          where: { id: { in: affectedWorkOrderIds } },
          select: {
            id: true,
            batchNumber: true,
            status: true,
            steps: { select: { id: true } },
          },
        });

        // Sadece tamamlanma için aday olanlar (COMPLETED/CANCELLED dışı + step'i olan)
        const candidates = wos.filter(
          (w) =>
            w.status !== WorkOrderStatus.COMPLETED &&
            w.status !== WorkOrderStatus.CANCELLED &&
            w.steps.length > 0
        );

        if (candidates.length > 0) {
          // step → WO eşleme tablosu
          const stepToWo = new Map<string, string>();
          const allCandidateStepIds: string[] = [];
          for (const w of candidates) {
            for (const s of w.steps) {
              stepToWo.set(s.id, w.id);
              allCandidateStepIds.push(s.id);
            }
          }

          // Tek query ile tüm aday WO'ların step'lerine dair aktif roll'ları çek;
          // hangi WO'larda en az bir aktif kalmış belirle.
          const activeRolls = await tx.roll.findMany({
            where: {
              OR: [
                { producedInStepId: { in: allCandidateStepIds } },
                { currentStepId: { in: allCandidateStepIds } },
              ],
              status: { in: ACTIVE_ROLL_STATUSES },
            },
            select: { producedInStepId: true, currentStepId: true },
          });
          const wosWithActive = new Set<string>();
          for (const r of activeRolls) {
            const fromProduced = r.producedInStepId
              ? stepToWo.get(r.producedInStepId)
              : undefined;
            const fromCurrent = r.currentStepId
              ? stepToWo.get(r.currentStepId)
              : undefined;
            if (fromProduced) wosWithActive.add(fromProduced);
            if (fromCurrent) wosWithActive.add(fromCurrent);
          }

          const toComplete = candidates.filter((w) => !wosWithActive.has(w.id));
          if (toComplete.length > 0) {
            const completeIds = toComplete.map((w) => w.id);
            await tx.workOrder.updateMany({
              where: { id: { in: completeIds } },
              data: { status: WorkOrderStatus.COMPLETED },
            });
            // WO kapandı → açık refakat kartlarını COMPLETED'a çek (tek query)
            await tx.travelerCard.updateMany({
              where: { workOrderId: { in: completeIds }, status: "ACTIVE" },
              data: { status: "COMPLETED" },
            });
            for (const w of toComplete) workOrdersCompleted.push(w.batchNumber);
          }
        }
      }

      return updated;
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      oldData: { status: ShipmentStatus.PREPARING },
      newData: {
        status: ShipmentStatus.SHIPPED,
        rollCount: shipment.items.length,
        ordersCompleted,
        ordersPartial,
        workOrdersCompleted,
      },
    });

    return {
      success: true,
      data: {
        shipment: updatedShipment,
        rollupdated: shipment.items.length,
        ordersCompleted,
        ordersPartial,
        workOrdersCompleted,
      },
      message: `Sevkiyat onaylandı. ${shipment.items.length} top sevk edildi.`,
    };
  }

  /**
   * Geriye dönük: SHIPPED bir sevkiyatın itemlerini sipariş satırlarına bağlar
   * (OrderAllocation create) ve etkilenen siparişleri yeniden hesaplar.
   *
   * Use case: stoktan üretilip irsaliyesiz sevk edilen malları, sonradan gelen
   * bir siparişe geriye dönük tahsis edip siparişi otomatik kapatmak.
   *
   * Kurallar:
   *   - Shipment SHIPPED olmalı (PREPARING için zaten tambur.allocate kullanılıyor)
   *   - Order ve Shipment aynı müşteriye ait olmalı (kross-customer atama yasak)
   *   - Roll bu shipment'a dahil olmalı
   *   - Roll.ownerCustomerId varsa o müşteri ile eşleşmeli
   *   - allocatedQty > 0 ve roll'un kalan kapasitesini aşmamalı
   *   - Aynı (rollId, orderLineId) çifti zaten varsa hata
   */
  async bindShipmentToOrders(
    shipmentId: string,
    bindings: Array<{
      rollId: string;
      orderLineId: string;
      allocatedQty: number;
    }>,
    userId?: string
  ): Promise<
    ApiResponse<{
      created: number;
      ordersCompleted: string[];
      ordersPartial: string[];
    }>
  > {
    if (!bindings || bindings.length === 0) {
      throw AppError.badRequest("En az bir bağlama girişi gerekli");
    }

    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        items: { select: { rollId: true } },
      },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.SHIPPED) {
      throw AppError.badRequest(
        `Geriye dönük bağlama yalnızca SHIPPED sevkiyatlar için. Mevcut: ${shipment.status}`
      );
    }

    const shipmentRollIds = new Set(shipment.items.map((it) => it.rollId));

    // Tüm hedef order line'ları + roller önden çek (validation + döngü için)
    const orderLineIds = Array.from(new Set(bindings.map((b) => b.orderLineId)));
    const rollIds = Array.from(new Set(bindings.map((b) => b.rollId)));

    const [orderLines, rolls] = await Promise.all([
      prisma.orderLine.findMany({
        where: { id: { in: orderLineIds } },
        include: {
          order: { select: { id: true, customerId: true, orderNumber: true } },
        },
      }),
      prisma.roll.findMany({
        where: { id: { in: rollIds } },
        include: { allocations: true },
      }),
    ]);

    const orderLineMap = new Map(orderLines.map((ol) => [ol.id, ol]));
    const rollMap = new Map(rolls.map((r) => [r.id, r]));

    // Validation
    for (const b of bindings) {
      const ol = orderLineMap.get(b.orderLineId);
      if (!ol) throw AppError.notFound(`Sipariş satırı bulunamadı: ${b.orderLineId}`);
      if (ol.order.customerId !== shipment.customerId) {
        throw AppError.badRequest(
          `Sipariş ${ol.order.orderNumber} farklı müşteriye ait — sevkiyat müşterisiyle eşleşmiyor`
        );
      }

      const roll = rollMap.get(b.rollId);
      if (!roll) throw AppError.notFound(`Top bulunamadı: ${b.rollId}`);
      if (!shipmentRollIds.has(b.rollId)) {
        throw AppError.badRequest(`Top ${roll.barcode} bu sevkiyata dahil değil`);
      }
      if (roll.ownerCustomerId && roll.ownerCustomerId !== shipment.customerId) {
        throw AppError.badRequest(
          `Top ${roll.barcode} başka bir müşterinin malı (SERVICE_PRODUCTION) — atanamaz`
        );
      }

      if (!(b.allocatedQty > 0)) {
        throw AppError.badRequest(`Tahsis miktarı pozitif olmalı (${roll.barcode})`);
      }
      const existingTotal = roll.allocations.reduce(
        (s, a) => s + a.allocatedQty,
        0
      );
      // Aynı (rollId, orderLineId) duplicate kontrolü
      if (
        roll.allocations.some((a) => a.orderLineId === b.orderLineId)
      ) {
        throw AppError.conflict(
          `Top ${roll.barcode} zaten bu sipariş satırına tahsis edilmiş`
        );
      }
      if (existingTotal + b.allocatedQty > roll.currentQty) {
        throw AppError.badRequest(
          `Top ${roll.barcode}: yetersiz kapasite. Mevcut: ${roll.currentQty}m, ` +
            `tahsis edilmiş: ${existingTotal}m, istenen: ${b.allocatedQty}m`
        );
      }
    }

    const affectedOrderIds = new Set<string>(
      orderLines.map((ol) => ol.order.id)
    );

    const ordersCompleted: string[] = [];
    const ordersPartial: string[] = [];

    await prisma.$transaction(async (tx) => {
      for (const b of bindings) {
        await tx.orderAllocation.create({
          data: {
            rollId: b.rollId,
            orderLineId: b.orderLineId,
            allocatedQty: b.allocatedQty,
          },
        });
      }

      for (const orderId of affectedOrderIds) {
        const result = await recomputeOrderCompletion(tx, orderId);
        if (!result) continue;
        if (result.completed) {
          ordersCompleted.push(result.orderNumber);
        } else {
          ordersPartial.push(result.orderNumber);
        }
      }
    });

    await Promise.all(
      bindings.map((b) =>
        AuditService.log({
          userId,
          action: "CREATE",
          tableName: "ORDER_ALLOCATION",
          recordId: `${b.rollId}:${b.orderLineId}`,
          newData: {
            shipmentId,
            rollId: b.rollId,
            orderLineId: b.orderLineId,
            allocatedQty: b.allocatedQty,
            retroactive: true,
          },
        })
      )
    );

    return {
      success: true,
      data: {
        created: bindings.length,
        ordersCompleted,
        ordersPartial,
      },
      message: `${bindings.length} kalem siparişe bağlandı. ${ordersCompleted.length} sipariş tamamlandı.`,
    };
  }

  /**
   * List shipments (optionally filtered by status / customer).
   */
  async listShipments(filters?: {
    status?: ShipmentStatus;
    customerId?: string;
    q?: string;
    limit?: number;
    offset?: number;
    cursor?: string;
    mode?: "offset" | "cursor";
    withTotal?: boolean;
    dateFrom?: Date;
    dateTo?: Date;
    dateField?: "createdAt" | "shippedAt" | "plannedDate";
    sortBy?:
      | "shipmentNumber"
      | "createdAt"
      | "shippedAt"
      | "plannedDate"
      | "carrier"
      | "status";
    sortOrder?: "asc" | "desc";
  }): Promise<
    | (ApiResponse<Shipment[]> & {
        pagination: { total: number; limit: number; offset: number; hasMore: boolean };
      })
    | (ApiResponse<Shipment[]> & {
        pagination: { nextCursor: string | null; hasMore: boolean; limit: number; totalEstimate?: number };
      })
  > {
    const limit = Math.min(100, Math.max(1, filters?.limit ?? 50));
    const offset = Math.max(0, filters?.offset ?? 0);
    const q = filters?.q?.trim();
    const isPreparing = filters?.status === ShipmentStatus.PREPARING;
    const useCursor = filters?.mode === "cursor" || !!filters?.cursor;

    const searchOR: Prisma.ShipmentWhereInput[] | undefined = q
      ? [
          { shipmentNumber: { contains: q, mode: "insensitive" } },
          { customer: { name: { contains: q, mode: "insensitive" } } },
          { plateNumber: { contains: q, mode: "insensitive" } },
        ]
      : undefined;

    const dateField = filters?.dateField ?? "createdAt";
    const dateRange =
      filters?.dateFrom || filters?.dateTo
        ? {
            [dateField]: {
              ...(filters?.dateFrom ? { gte: filters.dateFrom } : {}),
              ...(filters?.dateTo ? { lte: filters.dateTo } : {}),
            },
          }
        : {};

    const baseWhere: Prisma.ShipmentWhereInput = {
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.customerId ? { customerId: filters.customerId } : {}),
      ...(searchOR ? { OR: searchOR } : {}),
      ...dateRange,
    };

    const sortBy = filters?.sortBy ?? "createdAt";
    const sortOrder: "asc" | "desc" = filters?.sortOrder ?? "desc";

    const dynCursor = filters?.cursor ? decodeDynamicCursor(filters.cursor) : null;
    const where: Prisma.ShipmentWhereInput = useCursor && dynCursor
      ? { AND: [baseWhere, dynamicCursorWhere(dynCursor, sortBy, sortOrder)] }
      : baseWhere;

    const include = {
      customer: { select: { id: true, code: true, name: true } },
      branch: { select: { id: true, name: true, code: true } },
      plannedOrders: {
        select: {
          id: true,
          orderId: true,
          sortOrder: true,
          order: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              deadline: true,
            },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
      _count: { select: { items: true } },
    } as const;

    // PREPARING özel sırası (priority + plannedDate) sadece offset mode'da
    // ve sortBy verilmediğinde geçerli — kullanıcı sütun başlığına tıklayıp
    // sortBy seçtiyse onun isteğine saygı duyulur.
    const userSortRequested = !!filters?.sortBy;
    const orderByOffset: Prisma.ShipmentOrderByWithRelationInput[] =
      isPreparing && !userSortRequested
        ? [
            { priority: "asc" },
            { plannedDate: { sort: "asc", nulls: "last" } },
            { createdAt: "asc" },
          ]
        : [{ [sortBy]: sortOrder } as Prisma.ShipmentOrderByWithRelationInput];
    // Cursor mode: sortBy + id tie-breaker (aynı yönde — kararlı sayfalama).
    const orderByCursor: Prisma.ShipmentOrderByWithRelationInput[] = [
      { [sortBy]: sortOrder } as Prisma.ShipmentOrderByWithRelationInput,
      { id: sortOrder },
    ];

    // count(*) yalnız (a) offset mode'da (UI sayfa hesaplaması için zorunlu)
    // veya (b) cursor mode'da `withTotal` istendiğinde çalışsın. Cursor sayfalama
    // sırasında (ikinci/üçüncü sayfa) gereksiz tam-tablo count'tan kaçar.
    const wantTotal = !useCursor || filters?.withTotal === true;

    const [totalEstimate, shipmentsRaw] = await Promise.all([
      wantTotal
        ? prisma.shipment.count({ where: baseWhere })
        : Promise.resolve(undefined),
      useCursor
        ? prisma.shipment.findMany({
            where,
            include,
            orderBy: orderByCursor,
            take: limit + 1,
          })
        : prisma.shipment.findMany({
            where,
            include,
            orderBy: orderByOffset,
            skip: offset,
            take: limit,
          }),
    ]);

    if (useCursor) {
      const hasMore = shipmentsRaw.length > limit;
      const data = (hasMore ? shipmentsRaw.slice(0, limit) : shipmentsRaw) as Shipment[];
      const last = data[data.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore && last ? buildNextDynamicCursor(last, sortBy) : null;
      return {
        success: true,
        data,
        pagination: { nextCursor, hasMore, limit, totalEstimate },
      };
    }

    // wantTotal=true offset path için zorunlu (üstte set edildi).
    const offsetTotal = totalEstimate ?? 0;
    return {
      success: true,
      data: shipmentsRaw as Shipment[],
      pagination: {
        total: offsetTotal,
        limit,
        offset,
        hasMore: offset + shipmentsRaw.length < offsetTotal,
      },
    };
  }

  /**
   * Get a single shipment with all items (and their rolls) for the detail panel.
   */
  async getShipmentById(id: string): Promise<ApiResponse<Shipment>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      include: {
        customer: true,
        branch: { select: { id: true, name: true, code: true, city: true, address: true } },
        plannedOrders: {
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                status: true,
                deadline: true,
                lines: {
                  select: {
                    id: true,
                    quantity: true,
                    item: { select: { id: true, code: true, name: true } },
                    variant: { select: { id: true, code: true, name: true } },
                  },
                },
              },
            },
            addedBy: { select: { id: true, fullName: true } },
          },
          orderBy: { sortOrder: "asc" },
        },
        items: {
          include: {
            roll: {
              include: {
                item: true,
                variant: true,
                ownerCustomer: true,
                producedInStep: {
                  select: {
                    workOrder: {
                      select: { id: true, batchNumber: true, type: true },
                    },
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        sacks: {
          select: {
            id: true,
            sackNumber: true,
            weightKg: true,
            notes: true,
            createdAt: true,
            _count: { select: { rolls: true, swatches: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!shipment) {
      throw AppError.notFound("Sevkiyat bulunamadı");
    }

    // Müşteri desen karşılıklarını (customer variant alias) toplu çek ve her
    // item'a `customerAlias` olarak ekle — irsaliyede müşteri kendi adıyla görsün.
    const variantIds = Array.from(
      new Set(
        shipment.items
          .map((i) => i.roll.variantId)
          .filter((v): v is string => !!v),
      ),
    );

    const aliasByVariantId = new Map<
      string,
      { customerLabel: string; customerCode: string | null }
    >();

    if (variantIds.length > 0) {
      const aliases = await prisma.customerVariantAlias.findMany({
        where: {
          customerId: shipment.customerId,
          variantId: { in: variantIds },
          isActive: true,
        },
        select: { variantId: true, customerLabel: true, customerCode: true },
      });
      for (const a of aliases) {
        aliasByVariantId.set(a.variantId, {
          customerLabel: a.customerLabel,
          customerCode: a.customerCode,
        });
      }
    }

    const enrichedItems = shipment.items.map((item) => ({
      ...item,
      customerAlias:
        item.roll.variantId && aliasByVariantId.has(item.roll.variantId)
          ? aliasByVariantId.get(item.roll.variantId)!
          : null,
    }));

    return {
      success: true,
      data: { ...shipment, items: enrichedItems } as unknown as Shipment,
    };
  }

  /**
   * İrsaliye yazdırma verisi — snapshot-aware.
   *
   *   - SHIPPED + printSnapshot dolu → saklı snapshot döner (DONMUŞ belge)
   *   - SHIPPED + printSnapshot boş (eski veri) → canlı hesaplar (geriye uyumluluk)
   *   - PREPARING → canlı hesaplar (önizleme)
   *
   * Yani finalize sonrası ürün/varyant/alias/WO değişse bile bu endpoint
   * aynı veriyi döndürür.
   */
  async getPrintSnapshot(
    id: string,
  ): Promise<ApiResponse<ShipmentPrintSnapshot & { frozen: boolean }>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      select: { id: true, status: true, printSnapshot: true },
    });

    if (!shipment) {
      throw AppError.notFound("Sevkiyat bulunamadı");
    }

    if (
      shipment.status === ShipmentStatus.SHIPPED &&
      shipment.printSnapshot
    ) {
      const snap = shipment.printSnapshot as unknown as ShipmentPrintSnapshot;
      return { success: true, data: { ...snap, frozen: true } };
    }

    const live = await buildShipmentPrintSnapshot(prisma, id);
    return { success: true, data: { ...live, frozen: false } };
  }
}

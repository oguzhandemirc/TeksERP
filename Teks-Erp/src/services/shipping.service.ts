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

export class ShippingService {
  /**
   * Get orders that are ready for shipment.
   * Business Rule: Shows orders that have allocated rolls in PRODUCED or READY_FOR_SHIP.
   * Shipping dept does NOT see work orders.
   */
  async getReadyOrders(): Promise<ApiResponse<Record<string, unknown>[]>> {
    const orders = await prisma.order.findMany({
      where: {
        status: {
          in: [OrderStatus.APPROVED, OrderStatus.IN_PRODUCTION, OrderStatus.PARTIAL_SHIPPED],
        },
        lines: {
          some: {
            allocations: {
              some: {
                roll: {
                  status: { in: [RollStatus.PRODUCED, RollStatus.READY_FOR_SHIP, RollStatus.A1_STOCK, RollStatus.WAREHOUSE] },
                },
              },
            },
          },
        },
      },
      include: {
        customer: true,
        lines: {
          include: {
            item: true,
            allocations: {
              include: {
                roll: true,
              },
            },
          },
        },
      },
    });

    // Transform to shipping-friendly view
    const readyOrders = orders.map((order) => ({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customer.name,
      customerId: order.customerId,
      status: order.status,
      deadline: order.deadline,
      lines: order.lines.map((line) => ({
        lineId: line.id,
        itemName: line.item.name,
        requestedQty: line.quantity,
        allocatedRolls: line.allocations
          .filter((a) =>
            a.roll.status === RollStatus.PRODUCED ||
            a.roll.status === RollStatus.READY_FOR_SHIP ||
            a.roll.status === RollStatus.A1_STOCK ||
            a.roll.status === RollStatus.WAREHOUSE
          )
          .map((a) => ({
            allocationId: a.id,
            rollId: a.rollId,
            barcode: a.roll.barcode,
            allocatedQty: a.allocatedQty,
            rollStatus: a.roll.status,
            packageId: a.roll.packageId,
          })),
      })),
    }));

    return { success: true, data: readyOrders };
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
      driverName?: string;
      plateNumber?: string;
      carrier?: string;
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

    const shipment = await prisma.shipment.create({
      data: {
        shipmentNumber: generateShipmentNumber(),
        customerId: data.customerId,
        driverName: data.driverName ?? null,
        plateNumber: data.plateNumber ?? null,
        carrier: data.carrier ?? null,
        status: ShipmentStatus.PREPARING,
        customerCodeSnapshot: customer.code,
        customerNameSnapshot: customer.name,
      },
      include: { customer: true },
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
      },
    });

    return {
      success: true,
      data: shipment,
      message: `Sevkiyat oluşturuldu: ${shipment.shipmentNumber}`,
    };
  }

  /**
   * Add rolls to a shipment.
   *
   * CRITICAL BUSINESS RULE (Flexible Reassignment):
   * If a roll was allocated to a different customer's order, the old allocation
   * is detached and the roll is reassigned to the shipment's customer.
   */
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
          printSnapshot: printSnapshot as unknown as Prisma.InputJsonValue,
        },
        include: { customer: true },
      });

      // 2. Update all rolls to SHIPPED status
      for (const item of shipment.items) {
        await tx.roll.update({
          where: { id: item.rollId },
          data: { status: RollStatus.SHIPPED },
        });

        // Collect affected orders
        for (const allocation of item.roll.allocations) {
          affectedOrderIds.add(allocation.orderLine.orderId);
        }

        // Collect steps that link rolls → affected work orders
        if (item.roll.producedInStepId) affectedStepIds.add(item.roll.producedInStepId);
        if (item.roll.currentStepId) affectedStepIds.add(item.roll.currentStepId);
      }

      // 3. Auto-check order completion
      for (const orderId of affectedOrderIds) {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            lines: {
              include: {
                allocations: {
                  include: {
                    roll: {
                      include: { shipmentItems: true },
                    },
                  },
                },
              },
            },
          },
        });

        if (!order) continue;

        // Check each order line
        let allLinesComplete = true;
        for (const line of order.lines) {
          const totalShipped = line.allocations.reduce((sum, a) => {
            const shipped = a.roll.shipmentItems.reduce(
              (s, si) => s + si.shippedQty,
              0
            );
            return sum + shipped;
          }, 0);

          if (totalShipped < line.quantity) {
            allLinesComplete = false;
          }
        }

        const newStatus = allLinesComplete
          ? OrderStatus.COMPLETED
          : OrderStatus.PARTIAL_SHIPPED;

        await tx.order.update({
          where: { id: orderId },
          data: { status: newStatus },
        });

        if (allLinesComplete) {
          ordersCompleted.push(order.orderNumber);
        } else {
          ordersPartial.push(order.orderNumber);
        }
      }

      // 4. Auto-check work order completion.
      //    Bir WO'ya bağlı tüm toplar terminal duruma (SHIPPED/SCRAP/A1_STOCK/
      //    RETURNED_FROM_SUBCONTRACTOR) ulaştıysa WO.status = COMPLETED.
      //    ORDER_PRODUCTION / STOCK_PRODUCTION / SERVICE_PRODUCTION / REPAIR_REWORK
      //    tiplerinin hepsi bu yoldan geçer.
      const stepWorkOrders = await tx.workOrderStep.findMany({
        where: { id: { in: Array.from(affectedStepIds) } },
        select: { workOrderId: true },
      });
      const affectedWorkOrderIds = new Set(stepWorkOrders.map((s) => s.workOrderId));

      const ACTIVE_ROLL_STATUSES: RollStatus[] = [
        RollStatus.STOCK,
        RollStatus.IN_PRODUCTION,
        RollStatus.PRODUCED,
        RollStatus.READY_FOR_SHIP,
        RollStatus.AT_SUBCONTRACTOR,
        RollStatus.WAREHOUSE,
      ];

      for (const workOrderId of affectedWorkOrderIds) {
        const wo = await tx.workOrder.findUnique({
          where: { id: workOrderId },
          select: {
            batchNumber: true,
            status: true,
            steps: { select: { id: true } },
          },
        });
        if (!wo) continue;
        if (
          wo.status === WorkOrderStatus.COMPLETED ||
          wo.status === WorkOrderStatus.CANCELLED
        ) {
          continue;
        }

        const woStepIds = wo.steps.map((s) => s.id);
        if (woStepIds.length === 0) continue;

        const activeRollCount = await tx.roll.count({
          where: {
            OR: [
              { producedInStepId: { in: woStepIds } },
              { currentStepId: { in: woStepIds } },
            ],
            status: { in: ACTIVE_ROLL_STATUSES },
          },
        });

        if (activeRollCount === 0) {
          await tx.workOrder.update({
            where: { id: workOrderId },
            data: { status: WorkOrderStatus.COMPLETED },
          });
          // WO kapandı → açık refakat kartlarını COMPLETED'a çek
          await tx.travelerCard.updateMany({
            where: { workOrderId, status: "ACTIVE" },
            data: { status: "COMPLETED" },
          });
          workOrdersCompleted.push(wo.batchNumber);
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
   * List shipments (optionally filtered by status / customer).
   */
  async listShipments(filters?: {
    status?: ShipmentStatus;
    customerId?: string;
  }): Promise<ApiResponse<Shipment[]>> {
    const shipments = await prisma.shipment.findMany({
      where: {
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.customerId ? { customerId: filters.customerId } : {}),
      },
      include: {
        customer: true,
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, data: shipments };
  }

  /**
   * Get a single shipment with all items (and their rolls) for the detail panel.
   */
  async getShipmentById(id: string): Promise<ApiResponse<Shipment>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      include: {
        customer: true,
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

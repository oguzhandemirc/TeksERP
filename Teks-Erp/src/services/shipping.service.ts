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
import { Shipment, ShipmentStatus, RollStatus, OrderStatus } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";

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
                  status: { in: [RollStatus.PRODUCED, RollStatus.READY_FOR_SHIP, RollStatus.A1_STOCK] },
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
            a.roll.status === RollStatus.A1_STOCK
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
  ): Promise<ApiResponse<{ added: number; reassigned: number; notFound: number }>> {
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

    await prisma.$transaction(async (tx) => {
      for (const identifier of rollIds) {
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
          continue;
        }

        // Check if roll is already in another shipment
        const existingItem = await tx.shipmentItem.findUnique({
          where: { rollId: roll.id },
        });
        if (existingItem) continue; // Already in a shipment

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

    return {
      success: true,
      data: { added, reassigned, notFound },
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
    const affectedOrderIds = new Set<string>();

    const updatedShipment = await prisma.$transaction(async (tx) => {
      // 1. Update shipment status
      const updated = await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          status: ShipmentStatus.SHIPPED,
          shippedAt: new Date(),
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
      },
    });

    return {
      success: true,
      data: {
        shipment: updatedShipment,
        rollupdated: shipment.items.length,
        ordersCompleted,
        ordersPartial,
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
              include: { item: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!shipment) {
      throw AppError.notFound("Sevkiyat bulunamadı");
    }

    return { success: true, data: shipment };
  }
}

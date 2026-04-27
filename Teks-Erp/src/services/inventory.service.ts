// =============================================================================
// TeksERP - Inventory Service
// =============================================================================
// Handles initial goods receipt (Ham Mal Girişi / QC1) and inventory queries.
// Business Rule: Rolls default to STOCK status. IN_PRODUCTION or SHIPPED
// rolls are excluded from inventory queries unless explicitly filtered.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse, PaginatedResponse } from "../types/api.types";
import {
  parseQueryParams,
  buildWhereClause,
  buildOrderByClause,
  buildPagination,
} from "../utils/query-parser";
import { Request } from "express";
import { v4 as uuidv4 } from "uuid";
import { Prisma, Roll, RollStatus, RollOperationType } from "@prisma/client";
import {
  findOrCreateDerivedItem,
  getItemDerivedAttributes,
} from "./helpers/item-derive.helper";

export type RollHistoryEventKind =
  | "CREATED"
  | "MOVEMENT_IN"
  | "MOVEMENT_OUT"
  | "OPERATION"
  | "SUBCONTRACTOR_DISPATCH"
  | "SUBCONTRACTOR_RECEIPT"
  | "SHIPPED";

export interface RollHistoryEvent {
  kind: RollHistoryEventKind;
  subKind?: string;
  at: string;
  title: string;
  stationName: string | null;
  details: Record<string, unknown>;
  operatorName: string | null;
}

export interface RollHistoryPayload {
  roll: {
    id: string;
    barcode: string;
    status: RollStatus;
    initialQty: number;
    currentQty: number;
    weightKg: number | null;
    item: { id: string; code: string; name: string; itemType: string } | null;
    variant: { id: string; code: string; name: string } | null;
  };
  events: RollHistoryEvent[];
}

function operationLabel(type: RollOperationType): string {
  switch (type) {
    case "KURSUN_APPLIED":
      return "Kurşun Uygulandı";
    case "QC2_COMPLETED":
      return "QC2 Tamamlandı";
    case "TAMBUR_PROCESSED":
      return "Tambur İşlendi";
    case "PACKAGED":
      return "Paketlendi";
    case "SUBCONTRACTOR_SENT":
      return "Fasona Gönderildi";
    case "SUBCONTRACTOR_RETURNED":
      return "Fasondan Döndü";
    default:
      return type;
  }
}

/**
 * Generate a unique barcode string: TEKS-YYYYMMDD-XXXX
 */
function generateBarcode(): string {
  const now = new Date();
  const datePart =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, "0") +
    now.getDate().toString().padStart(2, "0");
  const randomPart = uuidv4().replace(/-/g, "").substring(0, 8).toUpperCase();
  return `TEKS-${datePart}-${randomPart}`;
}

export class InventoryService {
  /**
   * Initial goods receipt — creates a new Roll in STOCK status.
   * Generates unique barcode automatically.
   */
  async createInitialEntry(
    data: {
      itemId:       string;
      variantId?:    string | null;
      initialQty:   number;
      weightKg?:    number;
      qualityGrade?: string;
      width?:       number;  // En (cm)
    },
    userId?: string
  ): Promise<ApiResponse<Roll>> {
    // Verify item exists
    const item = await prisma.item.findUnique({ where: { id: data.itemId } });
    if (!item) {
      throw AppError.notFound("Ürün (Item) bulunamadı");
    }

    // Verify variant if provided
    if (data.variantId) {
      const variant = await prisma.itemVariant.findUnique({ where: { id: data.variantId } });
      if (!variant) {
        throw AppError.notFound("Varyant bulunamadı");
      }
      if (variant.itemId !== data.itemId) {
        throw AppError.badRequest("Varyant seçilen ürüne ait değil");
      }
    }

    const barcode = generateBarcode();

    const roll = await prisma.roll.create({
      data: {
        barcode,
        itemId:       data.itemId,
        variantId:    data.variantId ?? null,
        initialQty:   data.initialQty,
        currentQty:   data.initialQty,
        weightKg:     data.weightKg ?? null,
        status:       RollStatus.STOCK,
        qualityGrade: data.qualityGrade ?? "1.KALITE",
        width:        data.width ?? null,
      },
      include: { item: true, variant: true },
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: {
        barcode:      roll.barcode,
        itemId:       roll.itemId,
        variantId:    roll.variantId,
        initialQty:   roll.initialQty,
        currentQty:   roll.currentQty,
        weightKg:     roll.weightKg,
        status:       roll.status,
      },
    });

    return {
      success: true,
      data: roll,
      message: `Top oluşturuldu. Barkod: ${roll.barcode}`,
    };
  }

  /**
   * List rolls with dynamic filtering, sorting, pagination.
   * Business Rule: By default only STOCK rolls are returned.
   * Other statuses must be explicitly requested via filter[status].
   */
  async findAllRolls(req: Request): Promise<PaginatedResponse<Roll>> {
    const params = parseQueryParams(req);

    // Build base where clause from user filters
    const where = buildWhereClause(
      params.filters,
      ["barcode"],
      params.search
    );

    // "ALL" bypasses default STOCK filter; no filter means STOCK only
    if (params.filters["status"] === "ALL") {
      delete where.status;
    } else if (!params.filters["status"]) {
      where.status = RollStatus.STOCK;
    }

    // ownerType filtresi: "CUSTOMER" → müşteri malı, "FACTORY" → fabrika stoğu
    const ownerType = params.filters["ownerType"] as string | undefined;
    if (ownerType === "CUSTOMER") {
      where.ownerCustomerId = { not: null };
    } else if (ownerType === "FACTORY") {
      where.ownerCustomerId = null;
    }
    // ownerType filtresi buildWhereClause'a taşınmaması için temizle
    delete where.ownerType;

    const orderBy = buildOrderByClause(params.sortBy, params.sortOrder);
    const { skip, take } = buildPagination(params.page, params.pageSize);

    const [data, total] = await Promise.all([
      prisma.roll.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          item: true,
          variant: true,
          ownerCustomer: true,
          operations: { select: { operationType: true } },
        },
      }),
      prisma.roll.count({ where }),
    ]);

    return {
      success: true,
      data,
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        total,
        totalPages: Math.ceil(total / params.pageSize),
      },
    };
  }

  /**
   * Get a single roll by ID with all relations.
   */
  async findRollById(id: string): Promise<ApiResponse<Roll | null>> {
    const roll = await prisma.roll.findUnique({
      where: { id },
      include: {
        item: true,
        variant: true,
        ownerCustomer: true,
        errors: true,
        operations: { select: { operationType: true } },
        allocations: {
          include: {
            orderLine: {
              include: { order: true },
            },
          },
        },
      },
    });

    if (!roll) {
      return { success: false, data: null, message: "Top bulunamadı" };
    }

    return { success: true, data: roll };
  }

  /**
   * Get a roll by its barcode.
   */
  async findRollByBarcode(barcode: string): Promise<ApiResponse<Roll | null>> {
    const roll = await prisma.roll.findUnique({
      where: { barcode },
      include: {
        item: true,
        variant: true,
        ownerCustomer: true,
        errors: true,
        allocations: {
          include: {
            orderLine: {
              include: { order: true },
            },
          },
        },
      },
    });

    if (!roll) {
      return { success: false, data: null, message: "Barkod bulunamadı" };
    }

    return { success: true, data: roll };
  }

  /**
   * Get a roll's full lifecycle history — station movements, discrete operations,
   * subcontractor dispatches/receipts and shipment — merged into one chronological timeline.
   */
  async getRollHistory(id: string): Promise<ApiResponse<RollHistoryPayload | null>> {
    const roll = await prisma.roll.findUnique({
      where: { id },
      select: {
        id: true,
        barcode: true,
        status: true,
        initialQty: true,
        currentQty: true,
        weightKg: true,
        createdAt: true,
        item: { select: { id: true, code: true, name: true, itemType: true } },
        variant: { select: { id: true, code: true, name: true } },
      },
    });

    if (!roll) {
      return { success: false, data: null, message: "Top bulunamadı" };
    }

    const [movements, operations, dispatchItems, receiptItems, shipmentItems] =
      await Promise.all([
        prisma.rollMovement.findMany({
          where: { rollId: id },
          include: {
            step: { include: { station: true } },
            operator: { select: { id: true, username: true, fullName: true } },
          },
          orderBy: { enteredAt: "asc" },
        }),
        prisma.rollOperation.findMany({
          where: { rollId: id },
          include: {
            step: { include: { station: true } },
            operator: { select: { id: true, username: true, fullName: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.subcontractorDispatchItem.findMany({
          where: { rollId: id },
          include: {
            dispatch: {
              include: {
                company: { select: { id: true, code: true, name: true } },
                dispatchedBy: { select: { id: true, username: true, fullName: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.subcontractorReceiptItem.findMany({
          where: { newRollId: id },
          include: {
            receipt: {
              include: {
                company: { select: { id: true, code: true, name: true } },
                receivedBy: { select: { id: true, username: true, fullName: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.shipmentItem.findMany({
          where: { rollId: id },
          include: {
            shipment: {
              include: {
                customer: { select: { id: true, code: true, name: true } },
              },
            },
          },
        }),
      ]);

    const events: RollHistoryEvent[] = [];

    // Initial entry (Mal Kabul)
    events.push({
      kind: "CREATED",
      at: roll.createdAt.toISOString(),
      title: "Mal Kabul (Giriş)",
      stationName: null,
      details: {
        barcode: roll.barcode,
        initialQty: roll.initialQty,
        weightKg: roll.weightKg,
        itemCode: roll.item?.code,
        itemName: roll.item?.name,
        itemType: roll.item?.itemType,
      },
      operatorName: null,
    });

    for (const m of movements) {
      events.push({
        kind: "MOVEMENT_IN",
        at: m.enteredAt.toISOString(),
        title: `${m.step?.station?.name ?? "İstasyon"} – Giriş`,
        stationName: m.step?.station?.name ?? null,
        details: {
          qtyIn: m.qtyIn,
          weightIn: m.weightIn,
          notes: m.notes,
        },
        operatorName: m.operator?.fullName ?? m.operator?.username ?? null,
      });
      if (m.exitedAt) {
        events.push({
          kind: "MOVEMENT_OUT",
          at: m.exitedAt.toISOString(),
          title: `${m.step?.station?.name ?? "İstasyon"} – Çıkış`,
          stationName: m.step?.station?.name ?? null,
          details: {
            qtyOut: m.qtyOut,
            weightOut: m.weightOut,
            qtyIn: m.qtyIn,
            weightIn: m.weightIn,
            notes: m.notes,
          },
          operatorName: m.operator?.fullName ?? m.operator?.username ?? null,
        });
      }
    }

    for (const op of operations) {
      events.push({
        kind: "OPERATION",
        subKind: op.operationType,
        at: op.createdAt.toISOString(),
        title: operationLabel(op.operationType),
        stationName: op.step?.station?.name ?? null,
        details: {
          metadata: op.metadata,
        },
        operatorName: op.operator?.fullName ?? op.operator?.username ?? null,
      });
    }

    for (const di of dispatchItems) {
      events.push({
        kind: "SUBCONTRACTOR_DISPATCH",
        at: di.dispatch.dispatchedAt.toISOString(),
        title: `Fasona Sevk: ${di.dispatch.company?.name ?? "-"}`,
        stationName: null,
        details: {
          dispatchNo: di.dispatch.dispatchNo,
          companyCode: di.dispatch.company?.code,
          companyName: di.dispatch.company?.name,
          dispatchedQty: di.dispatchedQty,
          dispatchedWeight: di.dispatchedWeight,
          plateNumber: di.dispatch.plateNumber,
          driverName: di.dispatch.driverName,
        },
        operatorName:
          di.dispatch.dispatchedBy?.fullName ??
          di.dispatch.dispatchedBy?.username ??
          null,
      });
    }

    for (const ri of receiptItems) {
      events.push({
        kind: "SUBCONTRACTOR_RECEIPT",
        at: ri.receipt.receivedAt.toISOString(),
        title: `Fasondan Kabul: ${ri.receipt.company?.name ?? "-"}`,
        stationName: null,
        details: {
          receiptNo: ri.receipt.receiptNo,
          manifestNo: ri.receipt.manifestNo,
          companyCode: ri.receipt.company?.code,
          companyName: ri.receipt.company?.name,
          notes: ri.notes,
        },
        operatorName:
          ri.receipt.receivedBy?.fullName ??
          ri.receipt.receivedBy?.username ??
          null,
      });
    }

    for (const si of shipmentItems) {
      const when = si.shipment.shippedAt ?? si.shipment.createdAt;
      events.push({
        kind: "SHIPPED",
        at: when.toISOString(),
        title:
          si.shipment.status === "SHIPPED"
            ? `Sevk Edildi: ${si.shipment.customer?.name ?? "-"}`
            : `İrsaliyeye Eklendi: ${si.shipment.customer?.name ?? "-"}`,
        stationName: null,
        details: {
          shipmentNumber: si.shipment.shipmentNumber,
          shipmentStatus: si.shipment.status,
          customerCode: si.shipment.customer?.code,
          customerName: si.shipment.customer?.name,
          shippedQty: si.shippedQty,
          shippedWeight: si.shippedWeight,
        },
        operatorName: null,
      });
    }

    // Sort: first by timestamp, then by kind order (MOVEMENT_OUT before MOVEMENT_IN
    // before OPERATION) to correctly represent process flow when timestamps coincide.
    // Stable sort preserves original relative order for equal keys.
    // Eşit timestamp'te doğal süreç sırası:
    // istasyondan çıkış → o istasyondaki işlem/karar → sonraki istasyona giriş
    const kindOrder: Record<string, number> = {
      MOVEMENT_OUT: 0,
      OPERATION: 1,
      MOVEMENT_IN: 2,
      SUBCONTRACTOR_DISPATCH: 3,
      SUBCONTRACTOR_RECEIPT: 4,
      SHIPPED: 5,
      CREATED: 6,
    };
    events.sort((a, b) => {
      if (a.at < b.at) return -1;
      if (a.at > b.at) return 1;
      return (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9);
    });

    return {
      success: true,
      data: {
        roll: {
          id: roll.id,
          barcode: roll.barcode,
          status: roll.status,
          currentQty: roll.currentQty,
          initialQty: roll.initialQty,
          weightKg: roll.weightKg,
          item: roll.item,
          variant: roll.variant,
        },
        events,
      },
    };
  }

  /**
   * Soft-delete: sets roll status to SCRAP.
   * Only STOCK rolls can be scrapped.
   */
  async softDelete(id: string, userId?: string): Promise<ApiResponse<Roll>> {
    const existing = await prisma.roll.findUnique({ where: { id } });

    if (!existing) {
      throw AppError.notFound("Top bulunamadı");
    }

    if (existing.status !== RollStatus.STOCK) {
      throw AppError.badRequest("Sadece STOCK durumundaki toplar hurda olarak işaretlenebilir");
    }

    const updated = await prisma.roll.update({
      where: { id },
      data: { status: RollStatus.SCRAP },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: id,
      oldData: { status: existing.status },
      newData: { status: RollStatus.SCRAP },
    });

    return {
      success: true,
      data: updated,
      message: `Top hurda olarak işaretlendi: ${existing.barcode}`,
    };
  }

  /**
   * Hard-delete: physically removes the roll from the database.
   * Only STOCK or SCRAP rolls can be deleted.
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<Roll>> {
    const existing = await prisma.roll.findUnique({
      where: { id },
      include: { errors: true, allocations: true, shipmentItems: true },
    });

    if (!existing) {
      throw AppError.notFound("Top bulunamadı");
    }

    if (
      existing.status !== RollStatus.STOCK &&
      existing.status !== RollStatus.SCRAP
    ) {
      throw AppError.badRequest(
        "Sadece STOCK veya SCRAP durumundaki toplar kalıcı olarak silinebilir"
      );
    }

    await prisma.$transaction(async (tx) => {
      // Delete related records first
      await tx.rollError.deleteMany({ where: { rollId: id } });
      await tx.orderAllocation.deleteMany({ where: { rollId: id } });
      await tx.shipmentItem.deleteMany({ where: { rollId: id } });
      // Delete the roll
      await tx.roll.delete({ where: { id } });
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "ROLL",
      recordId: id,
      oldData: {
        barcode: existing.barcode,
        status: existing.status,
        currentQty: existing.currentQty,
      },
      newData: null,
    });

    return {
      success: true,
      data: existing,
      message: `Top kalıcı olarak silindi: ${existing.barcode}`,
    };
  }

  /**
   * Manuel kimlik override (hibrit mod) — operatör fason kabul sonrası bir
   * rulonun rengini/özelliklerini elle düzeltebilir. Senaryolar:
   *   - Boyahane mavi vermesi gereken 10 ruloda 2'si yanmazlık tutmamış →
   *     o 2 ruloya yanmazlık atanmaz (manuel kaldır).
   *   - Bir rulo bonus olarak ekstra özellik kazandı → operatör manuel ekler.
   *
   * Replace semantics: gönderilen colorId + propertyIds yeni TAM listedir.
   * Mevcut Roll.itemId'sinden baseItemId türetilir; baz item korunur.
   */
  async applyManualProperties(
    rollId: string,
    data: { colorId: string | null; propertyIds: string[] },
    userId?: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { id: true, barcode: true, itemId: true, status: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.status === RollStatus.SCRAP) {
      throw AppError.badRequest("Hurda topun kimliği değiştirilemez");
    }

    // Catalog doğrulamaları (varsa)
    if (data.colorId) {
      const c = await prisma.color.findUnique({
        where: { id: data.colorId },
        select: { isActive: true },
      });
      if (!c || !c.isActive) {
        throw AppError.badRequest("Renk bulunamadı veya pasif");
      }
    }
    const dedupedProps = [...new Set(data.propertyIds)];
    if (dedupedProps.length > 0) {
      const props = await prisma.fabricProperty.findMany({
        where: { id: { in: dedupedProps }, isActive: true },
        select: { id: true },
      });
      if (props.length !== dedupedProps.length) {
        throw AppError.badRequest("Bazı özellikler bulunamadı veya pasif");
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const current = await getItemDerivedAttributes(tx, roll.itemId);
      const derived = await findOrCreateDerivedItem(tx, {
        baseItemId: current.baseItemId,
        colorId: data.colorId,
        propertyIds: dedupedProps,
      });

      if (derived.itemId !== roll.itemId) {
        await tx.roll.update({
          where: { id: rollId },
          data: { itemId: derived.itemId },
        });
        await tx.systemLog.create({
          data: {
            userId: userId ?? null,
            action: "UPDATE",
            tableName: "ROLL_ITEM_MANUAL_OVERRIDE",
            recordId: rollId,
            oldData: {
              itemId: roll.itemId,
              colorId: current.colorId,
              propertyIds: current.propertyIds,
            } as Prisma.InputJsonValue,
            newData: {
              itemId: derived.itemId,
              itemCode: derived.itemCode,
              itemName: derived.itemName,
              colorId: data.colorId,
              propertyIds: dedupedProps,
              isNew: derived.isNew,
            } as Prisma.InputJsonValue,
          },
        });
      }

      return derived;
    });

    return {
      success: true,
      data: {
        rollId,
        itemId: result.itemId,
        itemCode: result.itemCode,
        itemName: result.itemName,
        colorId: data.colorId,
        propertyIds: dedupedProps,
        isNew: result.isNew,
      },
      message: `Top kimliği güncellendi: ${result.itemName}`,
    };
  }
}

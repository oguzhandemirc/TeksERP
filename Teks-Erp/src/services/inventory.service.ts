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
import { Roll, RollStatus } from "@prisma/client";

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
}

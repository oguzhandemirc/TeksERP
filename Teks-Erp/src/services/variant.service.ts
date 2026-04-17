// =============================================================================
// TeksERP - ItemVariant Service
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";

export class VariantService {
  /**
   * Create a new variant for an item.
   */
  async create(
    data: {
      itemId: string;
      code: string;
      name: string;
    },
    userId?: string
  ): Promise<ApiResponse<{ id: string; code: string; name: string; itemId: string }>> {
    // Verify item exists
    const item = await prisma.item.findUnique({ where: { id: data.itemId } });
    if (!item) {
      throw AppError.notFound("Ürün (Item) bulunamadı");
    }

    // Check if variant code already exists for this item
    const existing = await prisma.itemVariant.findUnique({
      where: { itemId_code: { itemId: data.itemId, code: data.code } },
    });
    if (existing) {
      throw AppError.conflict("Bu varyant kodu bu üründe zaten mevcut");
    }

    const variant = await prisma.itemVariant.create({
      data: {
        itemId: data.itemId,
        code: data.code,
        name: data.name,
      },
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ITEM_VARIANT",
      recordId: variant.id,
      newData: { itemId: variant.itemId, code: variant.code, name: variant.name },
    });

    return { success: true, data: variant, message: "Varyant oluşturuldu" };
  }

  /**
   * Get variants by item ID.
   */
  async findByItemId(itemId: string): Promise<ApiResponse<{ id: string; code: string; name: string }[]>> {
    const variants = await prisma.itemVariant.findMany({
      where: { itemId, isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    });

    return { success: true, data: variants };
  }

  /**
   * Delete a variant (soft delete - just mark as inactive).
   */
  async delete(id: string, userId?: string): Promise<ApiResponse<{ id: string }>> {
    const existing = await prisma.itemVariant.findUnique({ where: { id } });
    if (!existing) {
      throw AppError.notFound("Varyant bulunamadı");
    }

    await prisma.itemVariant.update({
      where: { id },
      data: { isActive: false },
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "ITEM_VARIANT",
      recordId: id,
      oldData: { isActive: true },
      newData: { isActive: false },
    });

    return { success: true, data: { id }, message: "Varyant silindi" };
  }
}

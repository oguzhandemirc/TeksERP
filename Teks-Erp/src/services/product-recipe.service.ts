// =============================================================================
// TeksERP - ProductRecipe Service
// =============================================================================
// BaseService + properties (FabricProperty) M:N replace override.
// BaseService.update() nested ilişkileri drop-recreate ETMEZ; reçete özellikleri
// PATCH'te değişebildiği için gelen `properties` dizisini Prisma nested-write
// { deleteMany, create } biçimine çeviririz (workorder.service deseni).

import prisma from "../lib/prisma";
import { BaseService } from "./base.service";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import type { ApiResponse } from "../types/api.types";

/** properties[] dizisinden BENZERSİZ propertyId'leri çıkar (dedup). */
function recipePropertyIds(properties: unknown): string[] {
  if (!Array.isArray(properties)) return [];
  return [
    ...new Set(
      (properties as Array<{ propertyId?: string }>)
        .map((p) => p?.propertyId)
        .filter((p): p is string => typeof p === "string" && p.length > 0)
    ),
  ];
}

export class ProductRecipeService extends BaseService {
  /** Dış referansların varlık+aktiflik (soft-delete giriş guard'ı) + width pozitif
   *  doğrulaması — bare BaseController Zod taşımadığından serviste (createInitialEntry/
   *  quality-grade desenleriyle aynı hijyen). Yalnız GÖNDERİLEN alanlar denetlenir. */
  private async validateRefs(data: Record<string, unknown>): Promise<void> {
    if (typeof data.itemId === "string" && data.itemId) {
      const item = await prisma.item.findFirst({
        where: { id: data.itemId, isActive: true },
        select: { id: true },
      });
      if (!item) throw AppError.badRequest("Reçete ürünü bulunamadı veya pasif");
    }
    if (typeof data.colorId === "string" && data.colorId) {
      const color = await prisma.color.findFirst({
        where: { id: data.colorId, isActive: true },
        select: { id: true },
      });
      if (!color) throw AppError.badRequest("Reçete rengi bulunamadı veya pasif");
    }
    if (typeof data.routeId === "string" && data.routeId) {
      const route = await prisma.route.findFirst({
        where: { id: data.routeId, isActive: true },
        select: { id: true },
      });
      if (!route) throw AppError.badRequest("Reçete rotası bulunamadı veya pasif");
    }
    if (data.width !== undefined && data.width !== null) {
      const w = Number(data.width);
      if (!Number.isFinite(w) || w <= 0) {
        throw AppError.badRequest("Reçete eni pozitif olmalı");
      }
    }
    if (Array.isArray(data.properties)) {
      const propertyIds = recipePropertyIds(data.properties);
      if (propertyIds.length > 0) {
        const found = await prisma.fabricProperty.findMany({
          where: { id: { in: propertyIds }, isActive: true },
          select: { id: true },
        });
        if (found.length !== propertyIds.length) {
          throw AppError.badRequest("Reçete özelliklerinden bazıları bulunamadı veya pasif");
        }
      }
    }
  }

  async create(
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    await this.validateRefs(data);
    const next = { ...data };
    // properties dedup → @@unique([recipeId,propertyId]) ihlali (P2002/409) önlenir.
    // BaseService config (nestedCreateFields:["properties"]) deduped diziyi {create:[...]} sarar.
    if (Array.isArray(next.properties)) {
      next.properties = recipePropertyIds(next.properties).map((propertyId) => ({ propertyId }));
    }
    return super.create(next, userId);
  }

  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    await this.validateRefs(data);
    const next = { ...data };
    if (Array.isArray(next.properties)) {
      // dedup → @@unique([recipeId,propertyId]) ihlali (P2002/409) önlenir.
      const ids = recipePropertyIds(next.properties);
      next.properties = {
        deleteMany: {},
        create: ids.map((propertyId) => ({ propertyId })),
      };
    }
    return super.update(id, next, userId);
  }

  /**
   * F215: pasif reçete kodu yeniden create edilince gelen `properties` UYGULANIR.
   * BaseService.reactivate nested alanları sessizce atardı → reçete bayat
   * özelliklerle dirilirdi. Item.create reactivate dalıyla aynı desen (M:N replace).
   */
  protected async reactivate(
    id: string,
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const { properties, ...rest } = data;
    const oldRecord = await this.delegate.findUnique({ where: { id } });
    const updateData: Record<string, unknown> = { ...rest, isActive: true };
    if (Array.isArray(properties)) {
      const ids = recipePropertyIds(properties);
      updateData.properties = {
        deleteMany: {},
        create: ids.map((propertyId) => ({ propertyId })),
      };
    }
    const updated = await this.delegate.update({
      where: { id },
      data: updateData,
      ...(this.config.defaultInclude ? { include: this.config.defaultInclude } : {}),
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: oldRecord as Record<string, unknown> | null,
      newData: updateData,
    });
    return {
      success: true,
      data: updated,
      message: "Pasif reçete yeniden aktive edildi",
    };
  }
}

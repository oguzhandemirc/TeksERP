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
import { applyFoldTypeForWriteInPlace } from "./helpers/fold-type";
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
  private async validateRefs(data: Record<string, unknown>, recipeId?: string): Promise<void> {
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

    // Item.allowedColors/allowedProperties kuralının reçetede de enforce'u —
    // sipariş satırı (order.service M-24) + KK1 aynı kuralı uyguluyor; reçete
    // bir prefill şablonu olsa da çelişkili (ürünün izinli listesi dışı renk/
    // özellik) kayıt üretemesin. PATCH'te itemId gelmese de mevcut reçeteden çözülür.
    const sentColorId = typeof data.colorId === "string" && data.colorId ? data.colorId : null;
    const sentPropIds = Array.isArray(data.properties) ? recipePropertyIds(data.properties) : [];
    if (sentColorId || sentPropIds.length > 0) {
      const effectiveItemId =
        typeof data.itemId === "string" && data.itemId
          ? data.itemId
          : recipeId
            ? (
                await prisma.productRecipe.findUnique({
                  where: { id: recipeId },
                  select: { itemId: true },
                })
              )?.itemId ?? null
            : null;
      if (effectiveItemId) {
        const item = await prisma.item.findUnique({
          where: { id: effectiveItemId },
          select: {
            name: true,
            allowedColors: { select: { colorId: true } },
            allowedProperties: { select: { propertyId: true } },
          },
        });
        if (item) {
          const allowedColors = new Set(item.allowedColors.map((c) => c.colorId));
          if (sentColorId && allowedColors.size > 0 && !allowedColors.has(sentColorId)) {
            throw AppError.badRequest(
              `Seçilen renk '${item.name}' ürününün izinli renk listesinde değil`,
            );
          }
          const allowedProps = new Set(item.allowedProperties.map((p) => p.propertyId));
          if (allowedProps.size > 0) {
            const outside = sentPropIds.find((p) => !allowedProps.has(p));
            if (outside) {
              throw AppError.badRequest(
                `Seçilen özelliklerden biri '${item.name}' ürününün izinli özellik listesinde değil`,
              );
            }
          }
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
    await applyFoldTypeForWriteInPlace(next); // D-13 biçim + katalog doğrulaması
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
    await this.validateRefs(data, id);
    const next = { ...data };
    await applyFoldTypeForWriteInPlace(next); // D-13 biçim + katalog doğrulaması
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
    await applyFoldTypeForWriteInPlace(updateData); // D-13 biçim + katalog doğrulaması
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

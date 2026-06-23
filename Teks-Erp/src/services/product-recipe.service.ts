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
import type { ApiResponse } from "../types/api.types";

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
  }

  async create(
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    await this.validateRefs(data);
    // properties nested-write'ı BaseService config (nestedCreateFields:["properties"]) halleder.
    return super.create(data, userId);
  }

  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    await this.validateRefs(data);
    const next = { ...data };
    if (Array.isArray(next.properties)) {
      const ids = (next.properties as Array<{ propertyId?: string }>)
        .map((p) => p.propertyId)
        .filter((p): p is string => typeof p === "string" && p.length > 0);
      next.properties = {
        deleteMany: {},
        create: ids.map((propertyId) => ({ propertyId })),
      };
    }
    return super.update(id, next, userId);
  }
}

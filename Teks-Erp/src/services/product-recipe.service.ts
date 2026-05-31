// =============================================================================
// TeksERP - ProductRecipe Service
// =============================================================================
// BaseService + properties (FabricProperty) M:N replace override.
// BaseService.update() nested ilişkileri drop-recreate ETMEZ; reçete özellikleri
// PATCH'te değişebildiği için gelen `properties` dizisini Prisma nested-write
// { deleteMany, create } biçimine çeviririz (workorder.service deseni).

import { BaseService } from "./base.service";
import type { ApiResponse } from "../types/api.types";

export class ProductRecipeService extends BaseService {
  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
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

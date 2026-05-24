// =============================================================================
// TeksERP - Item (Stok Kartı) Service
// =============================================================================
// Tek tip Item: ürün artık tek kayıttır (örn. "Patos"). Renk ve özellik
// kimliğin parçası DEĞİL — sipariş/iş emri/rulo seviyesinde taşınır. Üründe
// sadece "izin verilen renk/özellik listesi" tutulur (M:N).
//
// allowedColorIds / allowedPropertyIds:
//   - Boş = tüm aktif Color / FabricProperty serbest
//   - Dolu = sipariş/WO planlamada bu listeden seçilebilir
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { BaseService } from "./base.service";
import { ApiResponse } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { validateName, validateCode } from "../lib/string-validators";

export interface ItemCreateInput {
  code: string;
  name: string;
  itemType: string;
  unit?: string;
  isActive?: boolean;
  allowedColorIds?: string[];
  allowedPropertyIds?: string[];
}

export class ItemService extends BaseService {
  /**
   * Item create — sade CRUD. allowedColors/allowedProperties M:N replace.
   */
  async create(
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const input = data as unknown as ItemCreateInput;

    // Code + name: trim, required, max length (paylaşımlı validator)
    const validatedCode = validateCode(input.code, {
      label: "Ürün kodu",
      required: true,
    });
    if (typeof validatedCode === "string") input.code = validatedCode;
    const validatedName = validateName(input.name, {
      label: "Ürün ismi",
      required: true,
    });
    if (typeof validatedName === "string") input.name = validatedName;

    const allowedColorIds = [...new Set(input.allowedColorIds ?? [])];
    const allowedPropertyIds = [...new Set(input.allowedPropertyIds ?? [])];

    if (allowedColorIds.length > 0) {
      const colors = await prisma.color.findMany({
        where: { id: { in: allowedColorIds } },
        select: { id: true, name: true, isActive: true },
      });
      if (colors.length !== allowedColorIds.length) {
        throw AppError.badRequest("Bazı renkler bulunamadı");
      }
      const inactive = colors.find((c) => !c.isActive);
      if (inactive) {
        throw AppError.badRequest(`'${inactive.name}' rengi pasif`);
      }
    }

    if (allowedPropertyIds.length > 0) {
      const props = await prisma.fabricProperty.findMany({
        where: { id: { in: allowedPropertyIds } },
        select: { id: true, name: true, isActive: true },
      });
      if (props.length !== allowedPropertyIds.length) {
        throw AppError.badRequest("Bazı özellikler bulunamadı");
      }
      const inactive = props.find((p) => !p.isActive);
      if (inactive) {
        throw AppError.badRequest(`'${inactive.name}' özelliği pasif`);
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      return tx.item.create({
        data: {
          code: input.code.trim(),
          name: input.name.trim(),
          itemType: input.itemType as never,
          unit: input.unit ?? "MT",
          isActive: input.isActive ?? true,
          allowedColors:
            allowedColorIds.length > 0
              ? { create: allowedColorIds.map((colorId) => ({ colorId })) }
              : undefined,
          allowedProperties:
            allowedPropertyIds.length > 0
              ? { create: allowedPropertyIds.map((propertyId) => ({ propertyId })) }
              : undefined,
        },
        include: {
          allowedColors: { include: { color: true } },
          allowedProperties: { include: { property: true } },
        },
      });
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: this.config.tableName,
      recordId: created.id,
      newData: {
        code: created.code,
        name: created.name,
        itemType: created.itemType,
        allowedColorIds,
        allowedPropertyIds,
      },
    });

    return { success: true, data: created, message: "Ürün oluşturuldu" };
  }

  /**
   * Item update — code/itemType değişmez. name, unit, isActive ve allowed
   * listeler (replace semantiği) güncellenebilir.
   */
  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const FORBIDDEN = ["code", "itemType"];
    for (const k of FORBIDDEN) {
      if (Object.prototype.hasOwnProperty.call(data, k)) {
        throw AppError.badRequest(
          `'${k}' alanı güncellenemez. Yeni bir ürün tanımlayın.`,
        );
      }
    }

    // name güncelleniyorsa length + trim kontrolü
    if (data.name !== undefined) {
      const validated = validateName(data.name, {
        label: "Ürün ismi",
        required: true,
      });
      if (typeof validated === "string") data.name = validated;
    }

    const allowedColorIds = data.allowedColorIds as string[] | undefined;
    const allowedPropertyIds = data.allowedPropertyIds as string[] | undefined;
    const restData = { ...data };
    delete restData.allowedColorIds;
    delete restData.allowedPropertyIds;

    const hasListReplace =
      allowedColorIds !== undefined || allowedPropertyIds !== undefined;
    if (!hasListReplace) {
      return super.update(id, restData, userId);
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (allowedColorIds !== undefined) {
        await tx.itemAllowedColor.deleteMany({ where: { itemId: id } });
        if (allowedColorIds.length > 0) {
          await tx.itemAllowedColor.createMany({
            data: allowedColorIds.map((colorId) => ({ itemId: id, colorId })),
          });
        }
      }
      if (allowedPropertyIds !== undefined) {
        await tx.itemAllowedProperty.deleteMany({ where: { itemId: id } });
        if (allowedPropertyIds.length > 0) {
          await tx.itemAllowedProperty.createMany({
            data: allowedPropertyIds.map((propertyId) => ({ itemId: id, propertyId })),
          });
        }
      }
      return tx.item.update({
        where: { id },
        data: restData as Record<string, unknown>,
        include: {
          allowedColors: { include: { color: true } },
          allowedProperties: { include: { property: true } },
        },
      });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: id,
      newData: {
        ...restData,
        ...(allowedColorIds !== undefined ? { allowedColorIds } : {}),
        ...(allowedPropertyIds !== undefined ? { allowedPropertyIds } : {}),
      },
    });

    return { success: true, data: updated, message: "Kayıt güncellendi" };
  }

  /**
   * Tek bir rengi ürünün izinli listesine ekle. Mevcutsa idempotent (zaten dahil).
   * UI'da "Listeden Dahil Et" akışı için — tüm allowedColorIds göndermek yerine
   * tek satır insert, race condition riski yok.
   */
  async addAllowedColor(
    itemId: string,
    colorId: string,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const [item, color, existing] = await Promise.all([
      prisma.item.findUnique({
        where: { id: itemId },
        select: { id: true, isActive: true },
      }),
      prisma.color.findUnique({
        where: { id: colorId },
        select: { id: true, name: true, isActive: true },
      }),
      prisma.itemAllowedColor.findUnique({
        where: { itemId_colorId: { itemId, colorId } },
        include: { color: true },
      }),
    ]);

    if (!item || !item.isActive) {
      throw AppError.notFound("Ürün bulunamadı veya pasif");
    }
    if (!color) {
      throw AppError.notFound("Renk bulunamadı");
    }
    if (!color.isActive) {
      throw AppError.badRequest(`'${color.name}' rengi pasif`);
    }

    if (existing) {
      return { success: true, data: existing, message: "Renk zaten dahil" };
    }

    const created = await prisma.itemAllowedColor.create({
      data: { itemId, colorId },
      include: { color: true },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: itemId,
      newData: { allowedColorAdded: colorId },
    });

    return { success: true, data: created, message: "Renk dahil edildi" };
  }

  /**
   * Tek bir özelliği ürünün izinli listesine ekle. Mevcutsa idempotent.
   */
  async addAllowedProperty(
    itemId: string,
    propertyId: string,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const [item, property, existing] = await Promise.all([
      prisma.item.findUnique({
        where: { id: itemId },
        select: { id: true, isActive: true },
      }),
      prisma.fabricProperty.findUnique({
        where: { id: propertyId },
        select: { id: true, name: true, isActive: true },
      }),
      prisma.itemAllowedProperty.findUnique({
        where: { itemId_propertyId: { itemId, propertyId } },
        include: { property: true },
      }),
    ]);

    if (!item || !item.isActive) {
      throw AppError.notFound("Ürün bulunamadı veya pasif");
    }
    if (!property) {
      throw AppError.notFound("Özellik bulunamadı");
    }
    if (!property.isActive) {
      throw AppError.badRequest(`'${property.name}' özelliği pasif`);
    }

    if (existing) {
      return { success: true, data: existing, message: "Özellik zaten dahil" };
    }

    const created = await prisma.itemAllowedProperty.create({
      data: { itemId, propertyId },
      include: { property: true },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: itemId,
      newData: { allowedPropertyAdded: propertyId },
    });

    return { success: true, data: created, message: "Özellik dahil edildi" };
  }
}

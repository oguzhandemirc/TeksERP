// =============================================================================
// TeksERP - Item (Stok Kartı) Service
// =============================================================================
// Ham ve final (türetilmiş) Item yönetimi.
//
// Final Item kuralları (isDerived = true):
//   - baseItemId ZORUNLU + baseItem.isDerived = false olmalı
//   - colorId ZORUNLU (kimlik = baseItem + color)
//   - code DETERMINISTIC üretilir (kullanıcıdan gelen code göz ardı edilir)
//     Örn: PATOS + Mavi → "PATOS-MAVI"
//   - name otomatik önerilir; kullanıcı override edebilir
//   - allowedPropertyIds opsiyonel — Item'a uygulanabilir özellik listesi.
//     Boşsa = serbest (tüm aktif FabricProperty WO targetProperties'e eklenebilir).
//   - Aynı kombinasyon (code) varsa 409
// =============================================================================

import prisma from "../lib/prisma";
import { ItemType } from "@prisma/client";
import { AuditService } from "./audit.service";
import { BaseService } from "./base.service";
import { ApiResponse } from "../types/api.types";
import { AppError } from "../utils/app-error";
import {
  buildDerivedItemCode,
  buildDerivedItemName,
} from "./helpers/item-derive.helper";

export interface ItemCreateInput {
  code?: string;
  name?: string;
  itemType: string;
  unit?: string;
  isActive?: boolean;
  isDerived?: boolean;
  baseItemId?: string | null;
  colorId?: string | null;
  /** Item'a uygulanabilir özellikler (allowed). Boş = serbest. */
  allowedPropertyIds?: string[];
}

export class ItemService extends BaseService {
  /**
   * Item create — ham veya final ürün oluşturur.
   * Final için: kombinasyon doğrulanır, code/name otomatik üretilir, aynı
   * kombinasyon varsa 409 fırlatır.
   */
  async create(
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const input = data as unknown as ItemCreateInput;
    const isDerived = Boolean(input.isDerived);

    if (!isDerived) {
      // HAM ürün — kullanıcı code/name verir, basit doğrulama
      if (!input.code || !input.code.trim()) {
        throw AppError.badRequest("Ham ürün için kod zorunlu");
      }
      if (!input.name || !input.name.trim()) {
        throw AppError.badRequest("Ham ürün için isim zorunlu");
      }
      if (
        input.baseItemId ||
        input.colorId ||
        (input.allowedPropertyIds && input.allowedPropertyIds.length > 0)
      ) {
        throw AppError.badRequest(
          "Ham üründe temel ürün, renk veya özellik gönderilemez",
        );
      }
      return super.create(
        {
          code: input.code.trim(),
          name: input.name.trim(),
          itemType: input.itemType,
          unit: input.unit ?? "MT",
          isActive: input.isActive ?? true,
          isDerived: false,
        },
        userId,
      );
    }

    // FINAL ürün — kombinasyon doğrulama + deterministic code/name üretimi
    if (!input.baseItemId) {
      throw AppError.badRequest("Final ürün için temel (ham) ürün zorunlu");
    }
    if (!input.colorId) {
      throw AppError.badRequest("Final ürün için renk zorunlu");
    }
    const allowedPropertyIds = [...new Set(input.allowedPropertyIds ?? [])];

    const baseItem = await prisma.item.findUnique({
      where: { id: input.baseItemId },
      select: {
        id: true,
        code: true,
        name: true,
        itemType: true,
        unit: true,
        isDerived: true,
        isActive: true,
      },
    });
    if (!baseItem) throw AppError.badRequest("Temel ürün bulunamadı");
    if (baseItem.isDerived) {
      throw AppError.badRequest(
        "Temel ürün başka bir final ürün olamaz (zincir oluşturulamaz)",
      );
    }
    if (!baseItem.isActive) {
      throw AppError.badRequest("Temel ürün pasif");
    }

    const color = await prisma.color.findUnique({
      where: { id: input.colorId },
      select: { id: true, code: true, name: true, isActive: true },
    });
    if (!color || !color.isActive) {
      throw AppError.badRequest("Renk bulunamadı veya pasif");
    }

    let allowedProps: { id: string; name: string }[] = [];
    if (allowedPropertyIds.length > 0) {
      allowedProps = await prisma.fabricProperty.findMany({
        where: { id: { in: allowedPropertyIds } },
        select: { id: true, name: true, isActive: true },
      });
      if (allowedProps.length !== allowedPropertyIds.length) {
        throw AppError.badRequest("Bazı özellikler bulunamadı");
      }
      const inactive = allowedProps.find((p) => !("isActive" in p) || !(p as { isActive: boolean }).isActive);
      if (inactive) {
        throw AppError.badRequest(`'${inactive.name}' özelliği pasif`);
      }
    }

    const derivedCode = buildDerivedItemCode(baseItem.code, color.code);
    const derivedName =
      input.name && input.name.trim()
        ? input.name.trim()
        : buildDerivedItemName(baseItem.name, color.name);

    const existing = await prisma.item.findUnique({
      where: { code: derivedCode },
      select: { id: true, code: true, name: true },
    });
    if (existing) {
      throw AppError.conflict(
        `Bu kombinasyon zaten "${existing.name}" (${existing.code}) adıyla mevcut`,
      );
    }

    // Final ürün renk içerir → ham kumaştan türetilen final = boyalı kumaş.
    // Diğer tipler (YARN, WARP, CONSUMABLE) için boyalı varyant enum'u yok,
    // baseItem'dan inherit edilir.
    const derivedItemType =
      baseItem.itemType === ItemType.RAW_FABRIC
        ? ItemType.DYED_FABRIC
        : baseItem.itemType;

    const created = await prisma.$transaction(async (tx) => {
      return tx.item.create({
        data: {
          code: derivedCode,
          name: derivedName,
          itemType: derivedItemType,
          unit: input.unit ?? baseItem.unit,
          isActive: input.isActive ?? true,
          isDerived: true,
          baseItemId: baseItem.id,
          colorId: color.id,
          allowedProperties:
            allowedPropertyIds.length > 0
              ? { create: allowedPropertyIds.map((propertyId) => ({ propertyId })) }
              : undefined,
        },
        include: {
          baseItem: true,
          color: true,
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
        isDerived: true,
        baseItemId: baseItem.id,
        colorId: color.id,
        allowedPropertyIds,
      },
    });

    return { success: true, data: created, message: "Final ürün oluşturuldu" };
  }

  /**
   * Item update — kombinasyon (code/baseItemId/colorId/isDerived) değişmez.
   * name, unit, isActive ve allowedPropertyIds (M:N replace) güncellenebilir.
   */
  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const FORBIDDEN = ["code", "isDerived", "baseItemId", "colorId", "itemType"];
    for (const k of FORBIDDEN) {
      if (Object.prototype.hasOwnProperty.call(data, k)) {
        throw AppError.badRequest(
          `'${k}' alanı güncellenemez. Yeni bir ürün tanımlayın.`,
        );
      }
    }

    // allowedPropertyIds: replace semantics — eski tüm ItemProperty kayıtları
    // silinip yenileri yazılır. Diğer alanlar standart update.
    const allowedPropertyIds = data.allowedPropertyIds as string[] | undefined;
    const restData = { ...data };
    delete restData.allowedPropertyIds;

    if (allowedPropertyIds !== undefined) {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.itemProperty.deleteMany({ where: { itemId: id } });
        if (allowedPropertyIds.length > 0) {
          await tx.itemProperty.createMany({
            data: allowedPropertyIds.map((propertyId) => ({ itemId: id, propertyId })),
          });
        }
        return tx.item.update({
          where: { id },
          data: restData as Record<string, unknown>,
          include: {
            baseItem: true,
            color: true,
            allowedProperties: { include: { property: true } },
          },
        });
      });
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: this.config.tableName,
        recordId: id,
        newData: { ...restData, allowedPropertyIds },
      });
      return { success: true, data: updated, message: "Kayıt güncellendi" };
    }

    return super.update(id, restData, userId);
  }
}

// =============================================================================
// TeksERP - Customer Alias Service (Item + Color)
// =============================================================================
// Müşterinin bizdeki ürün/renk için kullandığı isim eşleştirmesi.
// Sipariş girişinde otomatik öneri olarak gelir; etiket basımında live okunur.
// OrderLine.customerItemName/customerColorName override ezer (bir-seferlik
// talep). Burada sadece master tablolar yönetilir; cascade label.service'te.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { normalizeDisplayName } from "./helpers/name-normalize.helper";
import { ApiResponse } from "../types/api.types";
import {
  CustomerItemAlias,
  CustomerColorAlias,
  Prisma,
} from "@prisma/client";

const TABLE_ITEM = "CUSTOMER_ITEM_ALIAS";
const TABLE_COLOR = "CUSTOMER_COLOR_ALIAS";

export interface AliasLookupResult {
  itemAlias: string | null; // master alias (null = yoksa)
  colorAlias: string | null;
}

export class CustomerAliasService {
  // ===========================================================================
  // ITEM ALIAS
  // ===========================================================================

  async listItemAliases(
    customerId: string
  ): Promise<ApiResponse<CustomerItemAlias[]>> {
    await assertCustomer(customerId);
    const rows = await prisma.customerItemAlias.findMany({
      where: { customerId },
      include: { item: { select: { id: true, code: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return { success: true, data: rows };
  }

  async upsertItemAlias(
    customerId: string,
    itemId: string,
    alias: string,
    userId?: string
  ): Promise<ApiResponse<CustomerItemAlias>> {
    await assertCustomer(customerId);
    await assertItem(itemId);
    // 2026-08-19 (kullanıcı kararı): alias da BÜYÜK saklanır — etikete/irsaliyeye
    // basılan müşteri adı `item.name` ile aynı rejimde olsun.
    const trimmed = normalizeDisplayName(alias);
    if (trimmed.length === 0) {
      throw AppError.badRequest("Alias boş olamaz");
    }

    const existing = await prisma.customerItemAlias.findUnique({
      where: { customerId_itemId: { customerId, itemId } },
    });

    const row = await prisma.customerItemAlias.upsert({
      where: { customerId_itemId: { customerId, itemId } },
      create: { customerId, itemId, alias: trimmed },
      update: { alias: trimmed },
    });

    await AuditService.log({
      userId,
      action: existing ? "UPDATE" : "CREATE",
      tableName: TABLE_ITEM,
      recordId: row.id,
      oldData: existing ? { alias: existing.alias } : null,
      newData: { customerId, itemId, alias: trimmed },
    });

    return { success: true, data: row };
  }

  async deleteItemAlias(
    customerId: string,
    itemId: string,
    userId?: string
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    const existing = await prisma.customerItemAlias.findUnique({
      where: { customerId_itemId: { customerId, itemId } },
    });
    if (!existing) throw AppError.notFound("Alias bulunamadı");

    await prisma.customerItemAlias.delete({ where: { id: existing.id } });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: TABLE_ITEM,
      recordId: existing.id,
      oldData: { customerId, itemId, alias: existing.alias },
    });

    return { success: true, data: { deleted: true } };
  }

  // ===========================================================================
  // COLOR ALIAS
  // ===========================================================================

  async listColorAliases(
    customerId: string
  ): Promise<ApiResponse<CustomerColorAlias[]>> {
    await assertCustomer(customerId);
    const rows = await prisma.customerColorAlias.findMany({
      where: { customerId },
      include: {
        color: {
          select: { id: true, code: true, name: true, hex: true, isActive: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return { success: true, data: rows };
  }

  async upsertColorAlias(
    customerId: string,
    colorId: string,
    alias: string,
    userId?: string
  ): Promise<ApiResponse<CustomerColorAlias>> {
    await assertCustomer(customerId);
    await assertColor(colorId);
    // 2026-08-19 (kullanıcı kararı): alias da BÜYÜK saklanır — etikete/irsaliyeye
    // basılan müşteri adı `item.name` ile aynı rejimde olsun.
    const trimmed = normalizeDisplayName(alias);
    if (trimmed.length === 0) {
      throw AppError.badRequest("Alias boş olamaz");
    }

    const existing = await prisma.customerColorAlias.findUnique({
      where: { customerId_colorId: { customerId, colorId } },
    });

    const row = await prisma.customerColorAlias.upsert({
      where: { customerId_colorId: { customerId, colorId } },
      create: { customerId, colorId, alias: trimmed },
      update: { alias: trimmed },
    });

    await AuditService.log({
      userId,
      action: existing ? "UPDATE" : "CREATE",
      tableName: TABLE_COLOR,
      recordId: row.id,
      oldData: existing ? { alias: existing.alias } : null,
      newData: { customerId, colorId, alias: trimmed },
    });

    return { success: true, data: row };
  }

  async deleteColorAlias(
    customerId: string,
    colorId: string,
    userId?: string
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    const existing = await prisma.customerColorAlias.findUnique({
      where: { customerId_colorId: { customerId, colorId } },
    });
    if (!existing) throw AppError.notFound("Alias bulunamadı");

    // F201: renk bu müşteriye ÖZEL atanmışsa (assigned=true) satırı SİLME — silersen
    // renk PUBLIC'e döner ve başka müşterilerin siparişlerinde serbest kalır (exclusive
    // atama sessizce yok olur). Yalnız adı temizle (color.service toKeepUnassigned simetriği).
    if (existing.assigned) {
      if (existing.alias === null) {
        return { success: true, data: { deleted: false } };
      }
      await prisma.customerColorAlias.update({
        where: { id: existing.id },
        data: { alias: null },
      });
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: TABLE_COLOR,
        recordId: existing.id,
        oldData: { customerId, colorId, alias: existing.alias },
        newData: { customerId, colorId, alias: null },
      });
      return { success: true, data: { deleted: false } };
    }

    // Yalnız ad taşıyan (assigned=false) satır — fiziksel silinebilir.
    await prisma.customerColorAlias.delete({ where: { id: existing.id } });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: TABLE_COLOR,
      recordId: existing.id,
      oldData: { customerId, colorId, alias: existing.alias },
    });

    return { success: true, data: { deleted: true } };
  }

  // ===========================================================================
  // LOOKUP — sadece master alias değerleri (cascade YOK; label.service uygular)
  // ===========================================================================

  /**
   * Bir müşteri için (item, color) alias'larını tek sorguda getirir.
   * Sipariş girişi öneri ekranı + label.service cascade için ortak yol.
   */
  async lookupAlias(
    customerId: string,
    itemId: string,
    colorId: string | null,
    tx?: Prisma.TransactionClient
  ): Promise<AliasLookupResult> {
    // F207: kardeş metodlarla (getAliases/setAlias) parite — müşteri var+aktif doğrula
    // (yoksa sessiz boş sonuç yerine net 404).
    await assertCustomer(customerId);
    const client = tx ?? prisma;
    // pg adapter: tx içinde Promise.all yasak — seri çekiyoruz.
    const itemRow = await client.customerItemAlias.findUnique({
      where: { customerId_itemId: { customerId, itemId } },
      select: { alias: true },
    });
    const colorRow = colorId
      ? await client.customerColorAlias.findUnique({
          where: { customerId_colorId: { customerId, colorId } },
          select: { alias: true },
        })
      : null;
    return {
      itemAlias: itemRow?.alias ?? null,
      colorAlias: colorRow?.alias ?? null,
    };
  }
}

// =============================================================================
// Local helpers
// =============================================================================

async function assertCustomer(customerId: string): Promise<void> {
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, isActive: true },
  });
  if (!c) throw AppError.notFound("Müşteri bulunamadı");
  if (!c.isActive) throw AppError.badRequest("Müşteri pasif durumda");
}

async function assertItem(itemId: string): Promise<void> {
  const i = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true, isActive: true },
  });
  if (!i) throw AppError.notFound("Ürün bulunamadı");
  if (!i.isActive) throw AppError.badRequest("Ürün pasif durumda");
}

async function assertColor(colorId: string): Promise<void> {
  const c = await prisma.color.findUnique({
    where: { id: colorId },
    select: { id: true, isActive: true },
  });
  if (!c) throw AppError.notFound("Renk bulunamadı");
  if (!c.isActive) throw AppError.badRequest("Renk pasif durumda");
}

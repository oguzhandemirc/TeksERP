// =============================================================================
// TeksERP - Müşteri × Kumaş × Renk Adı (kumaşa özel müşteri renk adı)
// =============================================================================
// Sözleşme: docs/design/MUSTERI-KUMAS-RENK-ADI.md §12. `CustomerAliasService`in
// dört metodu buraya delege eder (imza orada, gövde burada — dosya tavanı).
// Kardeş `upsertColorAlias`/`deleteColorAlias` aynalanır; iki bilinçli fark:
// silme atomik `delete` + P2025→404 (findUnique→if→delete deseni ALINMAZ) ve
// upsert yarışı P2002→409 kodlu döner. Yazma yolu YALNIZ burası (BaseController yok).
// =============================================================================

import { Prisma, type ItemLifecycleStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { normalizeDisplayName } from "./helpers/name-normalize.helper";
import { assertItemUsable } from "./helpers/item-usage.helper";
import { assertColor, assertCustomer } from "./helpers/customer-alias-gates.helper";
import type { ApiResponse } from "../types/api.types";

const TABLE = "CUSTOMER_ITEM_COLOR_ALIAS";

export interface CustomerItemColorAliasRow {
  id: string;
  customerId: string;
  itemId: string;
  colorId: string;
  alias: string;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  updatedById: string | null;
}
export interface ItemSummary { id: string; code: string; name: string; lifecycleStatus: ItemLifecycleStatus }
export interface ColorSummary { id: string; code: string; name: string; hex: string | null; isActive: boolean }
export interface CustomerSummary { id: string; code: string; name: string; isActive: boolean }

const ROW = {
  id: true, customerId: true, itemId: true, colorId: true, alias: true,
  createdAt: true, updatedAt: true, createdById: true, updatedById: true,
} as const;
const COLOR = { select: { id: true, code: true, name: true, hex: true, isActive: true } } as const;
const ORDER: Prisma.CustomerItemColorAliasOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];

const isPrismaCode = (e: unknown, code: string): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === code;

/** A — cari kartı: müşterinin bütün kumaşa özel renk adları. */
export async function listByCustomer(
  customerId: string,
): Promise<ApiResponse<(CustomerItemColorAliasRow & { item: ItemSummary; color: ColorSummary })[]>> {
  await assertCustomer(customerId);
  const rows = await prisma.customerItemColorAlias.findMany({
    where: { customerId },
    select: { ...ROW, item: { select: { id: true, code: true, name: true, lifecycleStatus: true } }, color: COLOR },
    orderBy: ORDER,
  });
  return { success: true, data: rows };
}

/** B — kumaş kartı: o kumaşa bütün müşterilerin verdiği renk adları. Pasif kumaş da LİSTELENİR. */
export async function listByItem(
  itemId: string,
): Promise<ApiResponse<(CustomerItemColorAliasRow & { customer: CustomerSummary; color: ColorSummary })[]>> {
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { id: true } });
  if (!item) throw AppError.notFound("Ürün bulunamadı");
  const rows = await prisma.customerItemColorAlias.findMany({
    where: { itemId },
    select: { ...ROW, customer: { select: { id: true, code: true, name: true, isActive: true } }, color: COLOR },
    orderBy: ORDER,
  });
  return { success: true, data: rows };
}

/** C — upsert. Kapı sırası kardeşle aynı; ilk hata döner. PUT idempotent. */
export async function upsert(
  key: { customerId: string; itemId: string; colorId: string },
  alias: string,
  userId?: string,
): Promise<ApiResponse<CustomerItemColorAliasRow>> {
  const { customerId, itemId, colorId } = key;
  await assertCustomer(customerId);
  await assertItemUsable(prisma, itemId, "DEFINITION");
  await assertColor(colorId);
  const ad = normalizeDisplayName(alias);
  if (ad.length === 0) throw AppError.badRequest("Alias boş olamaz");

  const where = { customerId_itemId_colorId: { customerId, itemId, colorId } };
  // Yalnız audit'in `oldData`sı için, en iyi çaba: bayat olabilir, karar girdisi değildir.
  const existing = await prisma.customerItemColorAlias.findUnique({ where, select: { alias: true } });
  let row: CustomerItemColorAliasRow;
  try {
    row = await prisma.customerItemColorAlias.upsert({
      where,
      create: { customerId, itemId, colorId, alias: ad, createdById: userId ?? null, updatedById: userId ?? null },
      update: { alias: ad, updatedById: userId ?? null },
      select: ROW,
    });
  } catch (e) {
    if (isPrismaCode(e, "P2002")) {
      throw AppError.conflict("Aynı ad aynı anda başka bir yerden yazıldı — tekrar deneyin.", {
        code: "ITEM_COLOR_ALIAS_CONFLICT",
      });
    }
    throw e;
  }

  await AuditService.log({
    userId,
    action: existing ? "UPDATE" : "CREATE",
    tableName: TABLE,
    recordId: row.id,
    oldData: existing ? { alias: existing.alias } : null,
    newData: { customerId, itemId, colorId, alias: ad },
  });
  return { success: true, data: row };
}

/** D — sil. Kart kapısı YOK: pasif karttaki adı temizlemek serbest (kardeş gibi). */
export async function remove(
  key: { customerId: string; itemId: string; colorId: string },
  userId?: string,
): Promise<ApiResponse<{ deleted: true }>> {
  let row: CustomerItemColorAliasRow;
  try {
    row = await prisma.customerItemColorAlias.delete({ where: { customerId_itemId_colorId: key }, select: ROW });
  } catch (e) {
    if (isPrismaCode(e, "P2025")) {
      throw AppError.notFound("Kumaşa özel renk adı bulunamadı", { code: "ITEM_COLOR_ALIAS_NOT_FOUND" });
    }
    throw e;
  }
  await AuditService.log({
    userId,
    action: "DELETE",
    tableName: TABLE,
    recordId: row.id,
    oldData: { customerId: row.customerId, itemId: row.itemId, colorId: row.colorId, alias: row.alias },
  });
  return { success: true, data: { deleted: true } };
}

// =============================================================================
// Müşteri adı eşlemelerinin ORTAK yazma kapıları — üç alias tablosu aynı
// kapılardan geçer (MUSTERI-KUMAS-RENK-ADI §3 MV-06: kardeşle simetrik).
// Kumaş kapısı `assertAliasItem` — yaşam döngüsü `assertItemUsable(…, "DEFINITION")`ten.
// =============================================================================

import { ItemType } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { assertItemUsable } from "./item-usage.helper";

/** Müşteri ürün adı yalnız stok kalemine verilir: hizmet kalemi (H6) etikete/irsaliyeye mal olarak basılmaz. */
export async function assertAliasItem(itemId: string): Promise<void> {
  const item = await assertItemUsable(prisma, itemId, "DEFINITION");
  if (item.itemType === ItemType.SERVICE) {
    throw AppError.badRequest("Hizmet kalemine müşteri ürün adı verilemez; yalnız stok kalemi (kumaş, iplik, sarf) seçilebilir", {
      code: "ALIAS_ITEM_NOT_STOCK",
    });
  }
}

export async function assertCustomer(customerId: string): Promise<void> {
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, isActive: true },
  });
  if (!c) throw AppError.notFound("Müşteri bulunamadı");
  if (!c.isActive) throw AppError.badRequest("Müşteri pasif durumda");
}

export async function assertColor(colorId: string): Promise<void> {
  const c = await prisma.color.findUnique({
    where: { id: colorId },
    select: { id: true, isActive: true },
  });
  if (!c) throw AppError.notFound("Renk bulunamadı");
  if (!c.isActive) throw AppError.badRequest("Renk pasif durumda");
}

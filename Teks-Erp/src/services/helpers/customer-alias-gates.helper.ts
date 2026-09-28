// =============================================================================
// Müşteri adı eşlemelerinin ORTAK yazma kapıları — üç alias tablosu aynı
// kapılardan geçer (MUSTERI-KUMAS-RENK-ADI §3 MV-06: kardeşle simetrik).
// Kumaş kapısı `assertItemUsable(…, "DEFINITION")` item-usage.helper'dadır.
// =============================================================================

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";

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

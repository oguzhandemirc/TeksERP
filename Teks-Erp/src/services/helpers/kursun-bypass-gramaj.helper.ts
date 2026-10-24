// =============================================================================
// KÂĞIT DAĞITIMIN GRAMAJI — `KursunBypassAssignment.propertyValueId` (KQ-D6)
// =============================================================================
// Kâğıtla yürüyen işte gramajı tablet basmaz; dağıtımcı panelde İSTEĞE BAĞLI girer
// (girilmezse özet "gramaj bilinmiyor" der). Değer kurşun ÇEŞİT özelliğinin aktif
// değeri olmalı (fail-closed 400). Tamamlanınca DONAR: değişimin atomik claim'i audit'li
// servistedir (`KursunBypassService.setGramaj`; bu dosya yalnız OKUR — audit'siz yazıcı artmaz).
// Bypass kuralı korunur: burada RollOperation YAZILMAZ.
// =============================================================================
import type { Prisma, PrismaClient } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { KURSUN_PROPERTY_CODE } from "./quality-station.helper";

type Reader = Prisma.TransactionClient | PrismaClient;

/** Değer kurşunun çeşit özelliğine ait ve aktif mi — değilse 400. */
export async function assertKursunGramajValue(db: Reader, valueId: string): Promise<void> {
  const ok = await db.fabricPropertyValue.count({
    where: { id: valueId, isActive: true, property: { isActive: true, variantOf: { code: KURSUN_PROPERTY_CODE } } },
  });
  if (ok === 0) {
    throw AppError.badRequest("Seçilen gramaj kurşun çeşidine ait değil ya da pasif", { code: "KURSUN_GRAMAJ_INVALID" });
  }
}

/** Kurşun çeşit özelliğinin AKTİF değerleri (25/50/100 gr), sıralı — seçici kaynağı. */
export async function loadKursunGramajOptions(): Promise<Array<{ id: string; name: string }>> {
  return prisma.fabricPropertyValue.findMany({
    where: { isActive: true, property: { isActive: true, variantOf: { code: KURSUN_PROPERTY_CODE } } },
    select: { id: true, name: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

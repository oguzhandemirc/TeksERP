// =============================================================================
// MÜŞTERİYE ÖZEL VARSAYILAN KURŞUN GRAMAJI — okuma (S3, fabrika cevabı 14, 2026-11-03)
// =============================================================================
// Yazım cari kartından (`cariService.update`, `kursunDefaultValueId`); burada yalnız İE formunun (panel + tablet)
// ön seçimi için müşteri → gramaj eşlemesi okunur. Pasif değer ya da pasif/birleşmiş cari listeye girmez →
// form istasyon varsayılanına düşer (bugünkü).
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { KURSUN_PROPERTY_CODE } from "./helpers/quality-station.helper";

export interface KursunCustomerDefault {
  customerId: string;
  valueId: string;
}

/** Geçerli müşteri gramajı — liste ucu ve istasyon varsayılan çözücüsü (K22) AYNI where'i okur. */
const VALID_CUSTOMER_DEFAULT = {
  kursunDefaultValueId: { not: null },
  customerId: { not: null },
  isActive: true,
  mergedIntoId: null,
  kursunDefaultValue: { isActive: true, property: { isActive: true, variantOf: { code: KURSUN_PROPERTY_CODE } } },
} satisfies Prisma.CariAccountWhereInput;

export async function listKursunCustomerDefaults(): Promise<KursunCustomerDefault[]> {
  const rows = await prisma.cariAccount.findMany({
    // Tek kart çözümü değil, gramajı dolu hesapların toplu listesi: süzgeç gramajdan başlar.
    where: VALID_CUSTOMER_DEFAULT,
    select: { customerId: true, kursunDefaultValueId: true },
    orderBy: { customerId: "asc" },
  });
  return rows.map((r) => ({ customerId: r.customerId!, valueId: r.kursunDefaultValueId! }));
}

/** Tek müşterinin gramajı (değer + ait olduğu çeşit özelliği); yoksa null. Ön muhasebe kapısı çağıranda. */
export async function findKursunCustomerDefault(customerId: string): Promise<{ valueId: string; propertyId: string } | null> {
  const row = await prisma.cariAccount.findFirst({
    where: { ...VALID_CUSTOMER_DEFAULT, customerId },
    select: { kursunDefaultValue: { select: { id: true, propertyId: true } } },
  });
  const v = row?.kursunDefaultValue;
  return v ? { valueId: v.id, propertyId: v.propertyId } : null;
}

// =============================================================================
// MÜŞTERİYE ÖZEL VARSAYILAN KURŞUN GRAMAJI — okuma (S3, fabrika cevabı 14, 2026-11-03)
// =============================================================================
// Yazım cari kartından (`cariService.update`, `kursunDefaultValueId`); burada yalnız İE formunun (panel + tablet)
// ön seçimi için müşteri → gramaj eşlemesi okunur. Pasif değer ya da pasif/birleşmiş cari listeye girmez →
// form istasyon varsayılanına düşer (bugünkü).
// =============================================================================
import prisma from "../lib/prisma";
import { KURSUN_PROPERTY_CODE } from "./helpers/quality-station.helper";

export interface KursunCustomerDefault {
  customerId: string;
  valueId: string;
}

export async function listKursunCustomerDefaults(): Promise<KursunCustomerDefault[]> {
  const rows = await prisma.cariAccount.findMany({
    where: {
      customerId: { not: null },
      isActive: true,
      mergedIntoId: null,
      kursunDefaultValue: { isActive: true, property: { isActive: true, variantOf: { code: KURSUN_PROPERTY_CODE } } },
    },
    select: { customerId: true, kursunDefaultValueId: true },
    orderBy: { customerId: "asc" },
  });
  return rows.map((r) => ({ customerId: r.customerId!, valueId: r.kursunDefaultValueId! }));
}

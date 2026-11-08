// =============================================================================
// SÜREÇ TÜRÜ → HİZMET KARTI — tek kaynak (genel fason F3/F9)
// =============================================================================
// Adım hizmet işinin (`service-step-work.helper.ts`) ve hareket geri alma kapısının
// (`service-billing-gate.helper.ts`) ORTAK sorusu: "bu adımın süreç türü hangi karta eşli?"
// Yalnız prisma — kapı helper'ı hafif kalsın, döngüsel import doğmasın.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

/** Adımın süreç türü: planlanan tür, yoksa istasyonun varsayılan türü. */
export function stepCategoryOf(step: { requiredCategoryId: string | null; station: { defaultCategoryId: string | null } }): string | null {
  return step.requiredCategoryId !== null ? step.requiredCategoryId : step.station.defaultCategoryId;
}

/** Eşlemeli süreç türleri: kategori → { kart, ad }. Pasif tür de sayılır (eşleme yaşıyorsa faturalar — fail-closed). */
export async function loadProcessMap(db: Db, categoryIds?: string[]): Promise<Map<string, { serviceItemId: string; name: string }>> {
  const rows = await db.serviceItemProcess.findMany({
    ...(categoryIds ? { where: { categoryId: { in: categoryIds } } } : {}),
    select: { categoryId: true, serviceItemId: true, category: { select: { name: true } } },
  });
  return new Map(rows.map((r) => [r.categoryId, { serviceItemId: r.serviceItemId, name: r.category.name }]));
}

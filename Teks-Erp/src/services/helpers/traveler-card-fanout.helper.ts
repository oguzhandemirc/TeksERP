// =============================================================================
// TeksERP — Refakat kartı WO fan-out yardımcısı
// =============================================================================
// Bir iş emrinin refakat kartının durumunu topluca değiştirir (WO-kapsamlı geçiş:
// tamamlanma / iptal-void / reopen). Kart İŞ EMRİ başınadır (bir WO = tek kart,
// workOrderId @unique), bu yüzden `where: { workOrderId }` doğrudan o kartı hedefler.
//
// Kart-scoped (tek karta, id ile) geçişler — tekil void — bu helper'a GİRMEZ;
// o traveler-card.service içinde id-bazlı kalır.
// =============================================================================
import { Prisma, TravelerCardStatus } from "@prisma/client";

/**
 * WO'ya bağlı kartlardan `from` durumundakileri `to` durumuna çeker (updateMany).
 * `voidMeta` verilirse (VOIDED geçişleri) `voidedAt` + `voidReason` de yazılır.
 * Etkilenen kart sayısını döner.
 */
export async function setWorkOrderCardStatusesTx(
  tx: Prisma.TransactionClient,
  workOrderId: string,
  from: TravelerCardStatus | TravelerCardStatus[],
  to: TravelerCardStatus,
  voidMeta?: { voidReason: string },
): Promise<number> {
  const fromList = Array.isArray(from) ? from : [from];
  const res = await tx.travelerCard.updateMany({
    // Kart iş emri başına → WO-kapsamlı geçiş doğrudan workOrderId ile.
    where: { workOrderId, status: { in: fromList } },
    data: {
      status: to,
      ...(voidMeta ? { voidedAt: new Date(), voidReason: voidMeta.voidReason } : {}),
    },
  });
  return res.count;
}

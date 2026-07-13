// =============================================================================
// TeksERP — Refakat kartı WO fan-out yardımcısı
// =============================================================================
// Bir iş emrinin refakat kart(lar)ının durumunu topluca değiştirir (WO-kapsamlı
// geçiş: tamamlanma / iptal-void / reopen). Bugün bir WO = tek ACTIVE kart; parti
// modeli geçişinde bir WO = N parti = N kart olacağından bu WO-kapsamlı geçişler
// TÜM partilerin kartlarına yayılmalı. Tek nokta: parti modeline geçişte yalnız
// buradaki `where` `{ batch: { workOrderId } }`'e döner → tüm çağrılar otomatik doğru.
//
// Kart-scoped (tek karta, id ile) geçişler — reprint (REPRINTED) ve tekil void —
// bu helper'a GİRMEZ; onlar traveler-card.service içinde id-bazlı kalır.
// =============================================================================
import { Prisma, TravelerCardStatus } from "@prisma/client";

/**
 * WO'ya bağlı kartlardan `from` durumundakileri `to` durumuna çeker (updateMany).
 * `voidMeta` verilirse (VOIDED geçişleri) `voidedAt` + `voidReason` de yazılır.
 * Etkilenen kart sayısını döner.
 */
export async function setWorkOrderCardStatuses(
  tx: Prisma.TransactionClient,
  workOrderId: string,
  from: TravelerCardStatus | TravelerCardStatus[],
  to: TravelerCardStatus,
  voidMeta?: { voidReason: string },
): Promise<number> {
  const fromList = Array.isArray(from) ? from : [from];
  const res = await tx.travelerCard.updateMany({
    where: { workOrderId, status: { in: fromList } },
    data: {
      status: to,
      ...(voidMeta ? { voidedAt: new Date(), voidReason: voidMeta.voidReason } : {}),
    },
  });
  return res.count;
}

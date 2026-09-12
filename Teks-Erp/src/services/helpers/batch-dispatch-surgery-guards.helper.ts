// =============================================================================
// TeksERP — K16 sevk cerrahisi ÖN KAPILARI (hiçbir mutasyondan ÖNCE)
// =============================================================================
// Cerrahinin kendisi `batch-dispatch-surgery.helper.ts`te; kapılar buraya ayrıldı
// (dosya boyut tavanı + kapının ayrı okunabilmesi). İkisi de 409 verir ve mesaj
// SOMUTTUR: hangi sevk, hangi top/belge.
// =============================================================================

import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";

/** Taşınacak kalemin kapılar için gereken asgari şekli. */
export interface SurgeryMovedItem {
  rollId: string;
  roll: { barcode: string | null };
  /** İptal edilmemiş makbuz kalemleri — doluysa kalem DÖNMÜŞTÜR. */
  receiptItems: Array<{ id: string }>;
}

/**
 * DÖNMÜŞ (kabul edilmiş) kalem taşınamaz (K16 madde 4). Dönen top zaten
 * `SUBCONTRACTOR_CONSUMED` olur ve normal akışta seçilemez — bu sed egzotik
 * halleri (elle müdahale, iptal edilmiş kabul sonrası) durdurur.
 */
export function assertNoReturnedItems(
  affected: Array<{ d: { dispatchNo: string }; movedItems: SurgeryMovedItem[] }>,
): void {
  for (const { d, movedItems } of affected) {
    const returned = movedItems.filter((i) => i.receiptItems.length > 0);
    if (returned.length > 0) {
      throw AppError.conflict(
        `Taşınamaz — dönmüş (kabul edilmiş) sevk kalemi taşınamaz: ` +
          `${returned.map((i) => i.roll.barcode ?? i.rollId).join(", ")} (sevk ${d.dispatchNo}).`,
      );
    }
  }
}

/**
 * Müşteriye DOĞRUDAN SEVK (DSK) yapılmış sevkin kalemi taşınamaz.
 *
 * Kısmi/alt küme doğrudan sevkte `directShippedAt` damgalanmaz ve bölünme çocuğu
 * sevk kalemi değildir; kalan top fasonda durur, kalem outstanding görünür — yani
 * bu şekli YALNIZ DSK kaydı ele verir. Kalemi başka partiye taşımak fason
 * karnesindeki teslim metrajının atfını koparır (DSK kalemin sevkinden okunur) ve
 * boşalan sevki iptale sürükler; müşteriye çıkmış malın sevki storno edilemez.
 */
export async function assertNoDirectShipmentTx(
  tx: Prisma.TransactionClient,
  dispatches: Array<{ id: string; dispatchNo: string }>,
): Promise<void> {
  if (dispatches.length === 0) return;
  const dskRows = await tx.directShipment.findMany({
    where: { dispatchId: { in: dispatches.map((d) => d.id) } },
    select: { dispatchId: true, shipmentNo: true },
  });
  if (dskRows.length === 0) return;
  const noById = new Map(dispatches.map((d) => [d.id, d.dispatchNo] as const));
  throw AppError.conflict(
    `Taşınamaz — şu sevk(ler)den müşteriye doğrudan sevk yapılmış: ` +
      `${dskRows.map((r) => `${noById.get(r.dispatchId) ?? r.dispatchId} (${r.shipmentNo})`).join(", ")}. ` +
      `Fasonda kalan mal için önce kabul yapın ya da 'kalan gelmeyecek' ile kapatın.`,
  );
}

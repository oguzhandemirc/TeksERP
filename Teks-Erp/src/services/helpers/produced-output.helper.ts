// =============================================================================
// İŞ EMRİ ÜRETİM ÇIKTISI KÜMESİ — TEK KAYNAK
// =============================================================================
// Liste ÇIKAN metriği, detay "Üretilen Nihai Toplar" ve kapanış künyesi AYNI
// kümeyi sorar; künye bu tanımı dondurur, canlı başlık bugün okur — ikisi
// ancak aynı yüklemden doğarsa "kapanışta ↔ bugün" farkı gerçek farktır.
// =============================================================================
import { Prisma, RollEntrySource, RollStatus } from "@prisma/client";

/**
 * WO ÜRETİM ÇIKTISI küme tanımı — liste (withProductionMeters) ve detay
 * (producedRolls) AYNI kümeyi kullanır (drift = iki ekranda farklı sayı).
 *
 * 2026-07-27 düzeltmesi: eski tanım `parent.entrySource=SUBCONTRACTOR_RETURN`
 * şartıyla YALNIZ fason-dönüşü açık kumaştan kesilen çocukları sayıyordu —
 * fasonsuz rota (stok top → KK1→KK2→Tambur) ve Tambur'suz biten rota
 * ("her rotanın son adımı final üretir": Kurşun/fason finalize) ÇIKAN=0
 * görünüyordu. Yeni küme iki daldan oluşur:
 *   a) Tambur birinci-nesil çocukları (entrySource=TAMBUR_SPLIT, bu WO'nun
 *      adımında doğmuş). AYNI WO içi re-cut torunları çift sayım nedeniyle
 *      hariç; ama BAŞKA WO'nun deposundan tüketilen TAMBUR_SPLIT parent'ın
 *      çocukları meşru çıktıdır (parent.producedInStepId kapsam şartı).
 *      Snapshot: sonradan TAMBUR_CONSUMED/CANCELLED olan çocuk listede kalır
 *      (detay rozet basar).
 *   b) Çocuğa bölünmeden nihai-ürün statüsüne ulaşan finalize çıktıları —
 *      rota Kurşun/QC2 veya fasonla bitti. Ara-tüketilenler
 *      (TAMBUR_CONSUMED/SUBCONTRACTOR_CONSUMED) ve canlı üretim bu dala giremez.
 */
export function producedOutputWhere(stepIds: string[]): Prisma.RollWhereInput {
  return {
    producedInStepId: { in: stepIds },
    OR: [
      {
        entrySource: RollEntrySource.TAMBUR_SPLIT,
        NOT: {
          parent: {
            entrySource: RollEntrySource.TAMBUR_SPLIT,
            producedInStepId: { in: stepIds },
          },
        },
      },
      {
        entrySource: { not: RollEntrySource.TAMBUR_SPLIT },
        status: {
          in: [
            RollStatus.WAREHOUSE,
            RollStatus.A1_STOCK,
            RollStatus.SCRAP,
            RollStatus.SHIPPED,
            RollStatus.AT_KARTELA,
            RollStatus.KARTELA_CONSUMED,
          ],
        },
      },
    ],
  };
}

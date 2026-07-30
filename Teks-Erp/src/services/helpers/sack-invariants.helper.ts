// =============================================================================
// Çuval içerik invariant'ları — "top FİZİKSEL olarak çuvalda mı?" TEK KAYNAK
// =============================================================================
// Çuval bir DEPO NESNESİDİR; içerik `Roll.sackId` ile tutulur. `Roll.shipmentId`
// YALNIZ sevkiyata atanınca yazılır (`shipping.service.createShipment`) → DEPO
// çuvalındaki topun `shipmentId`'si NULL'dır.
//
// ⚠️ BU YÜZDEN: "top çuvalda mı?" sorusunun cevabı `sackId`'DİR, `shipmentId`
// DEĞİLDİR. `shipmentId`'ye bakan guard depo çuvalındaki topu SERBEST sanır.
// 2026-07-30 bulgusu: `kartela.dispatch`, `tambur.cutWarehouseRoll`,
// `tambur.finalizeWarehouseCut` ve `subcontractor` auto-attach yolu tam bu hatayı
// yapıyordu → top `AT_KARTELA`/`TAMBUR_CONSUMED` olup çuvalda kalıyor, sevkte
// `SHIPPED`'e eziliyor ve şişmiş metraj DONMUŞ resmi irsaliyeye giriyordu.
// Yeni bir "çuvaldaki topu şuraya al" yolu eklerken `sackId` guard'ını ATLAMA.
//
// İKİ KÜME — biri diğerinin türevi:
//   SACK_ABSENT_STATUSES  : kayıtta çuvalda ama FİZİKSEL olarak binada DEĞİL.
//     SAYIM + BELGE yüzeylerinin dışlayacağı küme (etiket, liste, irsaliye, çeki).
//     `SHIPPED` BURADA YOK ve bu BİLİNÇLİ: sevk edilen top çuvalında kalır ve
//     irsaliyedeki TOP ADEDİ / METRE ile tutarlı sayılmalıdır.
//   NON_SACKABLE_STATUSES : çuvala GİREMEZ / çuvalda BULUNAMAZ = üstteki + SHIPPED.
//     `scanIntoSack` ve sevkiyat kurulum guard'ı bunu kullanır.
//
// `K18_DEAD_STATUSES` (`batch.service.ts`) ile KARIŞTIRMA: o küme "üyelik değişince
// etiket bayatlar mı" sorusunu yanıtlar (4 eleman, buranın ALT KÜMESİ). Amaçları
// farklı olduğu için birleştirilmedi; birini diğerinden TÜRETMEYİN.
// =============================================================================

import { RollStatus } from "@prisma/client";

/**
 * Kayıtta çuvalda ama fiziksel olarak binada OLMAYAN top durumları.
 * Sayım/belge yüzeyleri bu statüleri dışlar (`SHIPPED` hariç — bkz. dosya başlığı).
 */
export const SACK_ABSENT_STATUSES: RollStatus[] = [
  RollStatus.CANCELLED,
  RollStatus.SCRAP,
  RollStatus.IN_PRODUCTION,
  RollStatus.AT_SUBCONTRACTOR,
  RollStatus.SUBCONTRACTOR_CONSUMED,
  RollStatus.AT_KARTELA,
  RollStatus.KARTELA_CONSUMED,
  RollStatus.TAMBUR_CONSUMED,
];

/**
 * Çuvala okutulamayacak / sevke sokulamayacak top durumları. Kalite/bitmişlik
 * GATE'i YOK — envanterde fiziksel mevcut her top girer (ham `STOCK`, mamul
 * `WAREHOUSE`, 2.kalite `A1_STOCK`, fason dönüşü açık kumaş). Yalnız FİZİKSEL
 * İMKÂNSIZ durumlar bloklu: gitti (`SHIPPED`), fire, iptal, makinede, bina dışı,
 * emekli/tüketilmiş → bagajlanırsa çift-sayım.
 */
export const NON_SACKABLE_STATUSES: RollStatus[] = [
  ...SACK_ABSENT_STATUSES,
  RollStatus.SHIPPED,
];

/**
 * "Bu top bir çuvalda — o yüzden yapılamaz" mesajının TEK kaynağı. Dört guard
 * (kartela sevk, tambur kesim, tambur finalize, fason sevk) aynı metni basar;
 * operatöre ne yapacağını da söyler (yalnız "olmaz" demek sahada işe yaramıyor).
 *
 * @param ref    Topun barkodu (yoksa id)
 * @param sackNo Çuval kodu — biliniyorsa yazılır, operatör çuvalı bulabilsin
 * @param verb   Reddedilen eylem, mastar hâlde: "kartelaya gönderilemez"
 */
export function sackBlockMessage(
  ref: string,
  sackNo: string | null,
  verb: string
): string {
  return (
    `Top ${ref} bir çuvalda${sackNo ? ` (${sackNo})` : ""} — ${verb}. ` +
    `Önce "Paketleme / Çuvallar" ekranından topu çuvaldan çıkarın.`
  );
}

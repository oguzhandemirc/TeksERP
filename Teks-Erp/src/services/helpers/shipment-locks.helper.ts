// =============================================================================
// Çuval / sevkiyat satır kilitleri — içerik mutasyonunu atama ile serileştir
// =============================================================================
// ÇUVAL DEPO MODELİ. İki serileştirme noktası:
//   • touchWarehouseSackTx — DEPODAKİ çuvala (shipmentId NULL) içerik ekleme/çıkarma;
//     sevkiyat atama (createShipment) claim'iyle serileşir (sevk edilmekte olan çuvala
//     top eklenemez / eklenmekte olan çuval sevk edilemez). Mühür YOK — depodaki her
//     çuval her an düzenlenebilir; tek kilit sevkiyata atanma anıdır.
//   • touchShipmentPlannedTx — PLANNED sevkiyata çuval ekleme/çıkarma; dispatch/cancel
//     claim'leriyle serileşir (sevk edilmekte olan sevkiyattan çuval çıkarılamaz).
// =============================================================================

import { Prisma } from "@prisma/client";
import { ShipmentStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";

/**
 * Sevkiyat-kapsamlı advisory lock namespace'i (2026-08-09, denetim F-SEV-ESZ-001).
 * Uzay envanteri (audit/surface/12-tx-global-gercekler.md §4.2):
 *   8021 KK1 mükerrer giriş guard'ı · 8022 parti no üreteci · **8023 sevkiyat kapsamı**
 * ⚠️ 2 ARGÜMANLI form kullanılır. 1-argümanlı uzay AYRI bir uzaydır ve onu
 * `session-registry` + `permission-management` paylaşıyor; yeni bir alt sistemi
 * oraya sokmak, birbirini görmeyen iki alt sistemi sessizce serileştirir.
 */
// `: number` BİLEREK — literal tipe daralırsa bekçideki "namespace'ler farklı"
// karşılaştırması TS2367 ("bu iki literal hiç örtüşmez") ile derlenmez.
// `BATCH_NUMBER_LOCK_NS` de aynı sebeple açıkça tiplenmiş.
export const SHIPMENT_LOCK_NS: number = 8023;

/**
 * Bir SEVKİYATI tx ömrü boyunca kilitle — o sevkiyata dokunan diğer akışlarla
 * serileşmek için. Satır kilidi DEĞİL: korunan şey henüz OLMAYAN satırlardır
 * (phantom), ve satır kilidi phantom'u kapatmaz.
 *
 * NEDEN VAR (üretilmiş vaka): `undoDispatch` (storno) tx'i şu sırayla koşuyordu —
 * iade sayımı → bloklama kararı → sevkiyat claim'i → commit. `rollReturn.count`
 * kendi anlık görüntüsünü alır ve READ COMMITTED altında o andan commit'e kadar
 * açılan pencerede YENİ bir `RollReturn` doğabilir. İade tarafında topun atomik
 * claim'i var (`updateMany where {id, status: SHIPPED}` + `count===0 → throw`), bu
 * yüzden "storno önce commit ederse" iade reddedilir; ama TERS sıralama korunmasızdı:
 * iade önce commit ederse storno sayımı 0 okumuş olduğu için bloklamayı geçer ve
 * sevkiyatı PLANNED'a çeker.
 *
 * ÜRETİLDİ (2026-08-09): sayımdan sonra 1200 ms gecikme konulup o pencerede gerçek
 * `createReturn` koşturuldu → `undo-OK | iade-OK`, sonuç: sevkiyat PLANNED **ve**
 * aktif iade kaydı 1. Bu, `resolveUndoBlockReason`ın var olma sebebi olan YASAK
 * durumdur: iade irsaliyesi geçerli dururken ait olduğu çıkış belgesi VOIDED olur.
 *
 * ⚠️ SIRA LOAD-BEARING: kilit, koruduğu OKUMADAN önce alınmalı. `rollReturn.count`
 * sonrasına konursa hiçbir şey kazanılmaz (KK1 tuzağında birebir yaşandı).
 */
export async function lockShipmentScopeTx(
  tx: Prisma.TransactionClient,
  shipmentId: string,
): Promise<void> {
  // void dönüşü alt sorguda gizlenir — pg driver adapter void kolonu deserialize
  // edemiyor (UnsupportedNativeDataType); dışarı yalnız int çıkar.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SHIPMENT_LOCK_NS}::int, hashtext(${shipmentId}))`;
}

/**
 * DEPODAKİ çuval satırını kilitle (shipmentId NULL). Sevkiyata atanmış veya bulunmayan
 * çuvalda 409. İçerik ekleme/çıkarma tx'leri bununla sevkiyat-atama claim'ine serileşir.
 */
export async function touchWarehouseSackTx(
  tx: Prisma.TransactionClient,
  sackId: string
): Promise<void> {
  const touched = await tx.sack.updateMany({
    where: { id: sackId, shipmentId: null },
    data: { updatedAt: new Date() },
  });
  if (touched.count === 0) {
    throw AppError.conflict(
      "Çuval bu sırada bir sevkiyata atandı — içerik artık değiştirilemez. Sayfayı yenileyin."
    );
  }
}

/**
 * PLANNED sevkiyat satırını kilitle. Sevkiyat sevk/iptal edilmişse 409.
 * Çuval ekleme/çıkarma tx'leri bununla dispatch/cancel claim'lerine serileşir.
 */
export async function touchShipmentPlannedTx(
  tx: Prisma.TransactionClient,
  shipmentId: string
): Promise<void> {
  const touched = await tx.shipment.updateMany({
    where: { id: shipmentId, status: ShipmentStatus.PLANNED },
    data: { updatedAt: new Date() },
  });
  if (touched.count === 0) {
    throw AppError.conflict(
      "Sevkiyat bu sırada sevk / iptal edildi — çuval kümesi artık değiştirilemez. Sayfayı yenileyin."
    );
  }
}

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

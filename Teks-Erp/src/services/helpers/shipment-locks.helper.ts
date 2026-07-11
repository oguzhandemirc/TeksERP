// =============================================================================
// Çuval / sevkiyat satır kilitleri — içerik mutasyonunu mühür/atama ile serileştir
// =============================================================================
// ÇUVAL HAVUZU MODELİ. İki serileştirme noktası:
//   • touchOpenSackTx — AÇIK havuz çuvalına (shipmentId NULL, sealedAt NULL) içerik
//     ekleme/çıkarma; mühürleme (seal) claim'iyle serileşir (mühürlenmekte olan çuvala
//     top eklenemez / eklenmekte olan çuval mühürlenemez).
//   • touchShipmentPlannedTx — PLANNED sevkiyata çuval ekleme/çıkarma; dispatch/cancel
//     claim'leriyle serileşir (sevk edilmekte olan sevkiyattan çuval çıkarılamaz).
// =============================================================================

import { Prisma } from "@prisma/client";
import { ShipmentStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";

/**
 * AÇIK havuz çuvalı satırını kilitle (shipmentId NULL + sealedAt NULL). Mühürlü, sevkiyata
 * atanmış veya bulunmayan çuvalda 409. İçerik ekleme/çıkarma tx'leri bununla seal/atama
 * claim'lerine serileşir.
 */
export async function touchOpenSackTx(
  tx: Prisma.TransactionClient,
  sackId: string
): Promise<void> {
  const touched = await tx.sack.updateMany({
    where: { id: sackId, shipmentId: null, sealedAt: null },
    data: { updatedAt: new Date() },
  });
  if (touched.count === 0) {
    throw AppError.conflict(
      "Çuval bu sırada mühürlendi veya bir sevkiyata atandı — içerik artık değiştirilemez. Sayfayı yenileyin."
    );
  }
}

/**
 * PLANNED sevkiyat satırını kilitle. Sevkiyat kapı önüne çıkmış/sevk/iptal edilmişse 409.
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
      "Sevkiyat bu sırada kapı önüne çıktı / sevk / iptal edildi — çuval kümesi artık değiştirilemez. Sayfayı yenileyin."
    );
  }
}

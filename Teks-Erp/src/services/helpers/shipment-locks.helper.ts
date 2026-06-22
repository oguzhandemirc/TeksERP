// =============================================================================
// Sevkiyat satır kilitleri — içerik mutasyonu ile finalize'ı serileştir (M-2)
// =============================================================================
// Bu yardımcılar shipment satırına KOŞULLU updateMany atar: hem statüyü doğrular
// (PREPARING dışı → 409) hem de satır write-kilidini alır. Finalize claim'leri
// (markReady/moveToDoor/dispatch) aynı satıra updateMany attığından, içerik tx'i
// ile durum geçişi tamamen SERİLEŞİR. Önceden shipping.service'in private
// metodlarıydı; relabel (inventory.applyManualProperties) de aynı serileştirmeye
// girebilsin diye buraya taşındı (tek kaynak).
// =============================================================================

import { Prisma, ShipmentStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";

/**
 * PREPARING sevkiyat satırını kilitle. Sevkiyat hazırlıktan çıkmışsa (sevk/iptal/
 * çuval depo) 409. İçerik ekleme/çıkarma tx'leri bununla markReady claim'ine serileşir.
 */
export async function touchShipmentPreparingTx(
  tx: Prisma.TransactionClient,
  shipmentId: string
): Promise<void> {
  const touched = await tx.shipment.updateMany({
    where: { id: shipmentId, status: ShipmentStatus.PREPARING },
    data: { updatedAt: new Date() },
  });
  if (touched.count === 0) {
    throw AppError.conflict(
      "Sevkiyat bu sırada hazırlık aşamasından çıktı (sevk/iptal edilmiş olabilir) — sayfayı yenileyin."
    );
  }
}

/**
 * Sevk edilmemiş (PREPARING/READY/AT_DOOR) sevkiyat satırını kilitle — içerik
 * tx'lerini markReady/dispatch claim'leriyle serileştirir (touchShipmentPreparingTx'in
 * READY-farkındalı kardeşi; saha #3). Kilitlenen statüyü döndürür.
 */
export async function touchShipmentEditableTx(
  tx: Prisma.TransactionClient,
  shipmentId: string
): Promise<ShipmentStatus> {
  const touched = await tx.shipment.updateMany({
    where: {
      id: shipmentId,
      status: { in: [ShipmentStatus.PREPARING, ShipmentStatus.READY, ShipmentStatus.AT_DOOR] },
    },
    data: { updatedAt: new Date() },
  });
  if (touched.count === 0) {
    throw AppError.conflict(
      "Sevkiyat bu sırada sevk/iptal edildi — içerik artık değiştirilemez. Sayfayı yenileyin."
    );
  }
  const fresh = await tx.shipment.findUnique({ where: { id: shipmentId }, select: { status: true } });
  return fresh!.status;
}

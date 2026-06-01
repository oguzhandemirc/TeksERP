// =============================================================================
// Sipariş status hesabı — tek noktadan yönetilen geçişler
// =============================================================================
// Sadeleşmiş yaşam döngüsü:
//   PENDING → APPROVED → PARTIAL_SHIPPED → COMPLETED
//                     → CANCELLED (manuel)
//
// Sevk muhasebesi (GEVŞEK MODEL): top→sipariş bağı YOK. Bir siparişin "sevk
// edilen" metrajı = satırlarının OrderLine.shippedQty toplamı. shippedQty ise
// ShipmentAllocation toplamıdır — Sevke Hazır (READY) anında spec-toplam, seçilen
// siparişlere termin→tarih FIFO dağıtılınca yazılır; iptalde geri alınır. Bu
// helper o yazımlardan sonra tetiklenir, Order.shippedQty + status'u senkronlar.
// =============================================================================

import { Prisma, OrderStatus } from "@prisma/client";
import { readShippingToleranceMeters } from "../system-setting.service";

/**
 * Bir siparişin shippedQty ve status'unu yeniden hesaplar.
 *
 * Kurallar:
 *   - shippedQty = SUM(OrderLine.shippedQty)   (= Σ ShipmentAllocation.qty)
 *   - totalRequired = SUM(OrderLine.quantity)
 *   - shippedQty <= 0                                  → APPROVED
 *   - (totalRequired - shippedQty) <= tolerans          → COMPLETED
 *   - aksi                                              → PARTIAL_SHIPPED
 *
 * CANCELLED terminal — değişmez. COMPLETED ise: manuel kapatılmış (manualClosedById
 * dolu) sipariş terminal kalır; OTOMATİK kapanmış sipariş yeniden hesaplanabilir —
 * sevkiyat iptalinde shippedQty düşünce sipariş yeniden açılır (re-open). Tx kabul eder.
 */
export async function recomputeOrderStatus(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<{ changed: boolean; oldStatus: OrderStatus; newStatus: OrderStatus } | null> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      completedAt: true,
      manualClosedById: true,
      lines: { select: { quantity: true, shippedQty: true } },
    },
  });
  if (!order) return null;

  // İptal terminal; manuel kapatılmış sipariş de terminal (kullanıcı kararı korunur).
  if (
    order.status === OrderStatus.CANCELLED ||
    (order.status === OrderStatus.COMPLETED && order.manualClosedById != null)
  ) {
    return { changed: false, oldStatus: order.status, newStatus: order.status };
  }

  // Sevk edilen metraj — satır bazlı tahsis toplamı (spec-aggregate karşılanma)
  const shippedQty = order.lines.reduce(
    (sum, l) => sum.plus(l.shippedQty),
    new Prisma.Decimal(0)
  );

  const totalRequired = order.lines.reduce(
    (sum, l) => sum.plus(l.quantity),
    new Prisma.Decimal(0)
  );

  const tolerance = new Prisma.Decimal(await readShippingToleranceMeters(tx));

  let newStatus: OrderStatus = OrderStatus.APPROVED;
  if (shippedQty.greaterThan(0)) {
    newStatus = totalRequired.minus(shippedQty).lessThanOrEqualTo(tolerance)
      ? OrderStatus.COMPLETED
      : OrderStatus.PARTIAL_SHIPPED;
  }

  const changed = newStatus !== order.status;

  // shippedQty denormalizasyonunu her zaman güncelle; status'u değiştiyse onu da
  const data: Prisma.OrderUncheckedUpdateInput = { shippedQty };
  if (changed) {
    data.status = newStatus;
    if (newStatus === OrderStatus.COMPLETED && !order.completedAt) {
      data.completedAt = new Date();
    }
    // Re-open (COMPLETED → APPROVED/PARTIAL): otomatik tamamlanma izini temizle.
    if (newStatus !== OrderStatus.COMPLETED && order.completedAt) {
      data.completedAt = null;
    }
  }
  await tx.order.update({ where: { id: orderId }, data });

  return { changed, oldStatus: order.status, newStatus };
}

/**
 * Birden çok siparişin statusunu yeniden hesaplar (duplikatlar filtrelenir).
 */
export async function recomputeOrderStatusForOrders(
  tx: Prisma.TransactionClient,
  orderIds: string[]
): Promise<void> {
  const unique = [...new Set(orderIds)];
  for (const id of unique) {
    await recomputeOrderStatus(tx, id);
  }
}

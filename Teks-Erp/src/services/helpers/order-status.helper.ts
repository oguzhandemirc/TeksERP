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
 * Verilen OrderLine satırlarını write-kilitle (sevk muhasebesini serileştirmek için).
 *
 * Neden: `OrderLine.shippedQty` denormalize bir toplamdır ve birden fazla yol
 * (iki ayrı sevkiyatın markReady'si, iki paralel fason directShip) aynı satıra
 * göreli `increment` yazabilir. Kapasite (`quantity - shippedQty`) tx DIŞINDA
 * okunup tx İÇİNDE artırılırsa, READ COMMITTED altında iki işlem birbirinin
 * commit'ini görmeden geçer ve toplam `quantity`'yi aşar (over-coverage).
 * Bu yardımcı, kapasite TAZE okunmadan ÖNCE çağrılır: ikinci işlem burada bloklanır,
 * ilk commit'ten sonra güncel `shippedQty`'yi okur → cap doğru hesaplanır.
 *
 * Deadlock güvenliği: ID'ler SIRALI kilitlenir (her çağrı aynı sırayı izler).
 * Set-bazlı tek `UPDATE ... WHERE id = ANY()` kilit sırasını GARANTİ ETMEZ
 * (tarama sırası); o yüzden bilinçli olarak id başına ayrı updateMany (await
 * döngüsü — ESLint `Promise.all(tx.*)` yasağına da uygun). Satır sayısı bir
 * sevkiyat/sevk başına küçüktür.
 */
export async function touchOrderLinesTx(
  tx: Prisma.TransactionClient,
  orderLineIds: string[]
): Promise<void> {
  const ids = [...new Set(orderLineIds)].sort();
  for (const id of ids) {
    await tx.orderLine.updateMany({ where: { id }, data: { updatedAt: new Date() } });
  }
}

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
  orderId: string,
  // Çok-sipariş döngüsünde (recomputeOrderStatusForOrders) ayar bir kez okunup
  // geçilir; verilmezse buradan okunur (tek-sipariş çağrıları için geriye uyumlu).
  toleranceMeters?: number
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

  const tolerance = new Prisma.Decimal(
    toleranceMeters ?? (await readShippingToleranceMeters(tx))
  );

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
  if (unique.length === 0) return;
  // Sevk-tölerans ayarını BİR KEZ oku (eskiden her sipariş için tekrar DB'den
  // okunuyordu — loop içi N+1 read); sipariş başına geçir.
  const toleranceMeters = await readShippingToleranceMeters(tx);
  for (const id of unique) {
    await recomputeOrderStatus(tx, id, toleranceMeters);
  }
}

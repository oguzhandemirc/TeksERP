// =============================================================================
// Sipariş status hesabı — tek noktadan yönetilen geçişler
// =============================================================================
// Sadeleşmiş yaşam döngüsü:
//   PENDING → APPROVED → PARTIAL_SHIPPED → COMPLETED
//                     → CANCELLED (manuel)
//
// NOT: Sevkiyat modülü sıfırdan yazılıyor. Bu helper şu anda no-op — yeni
// sevkiyat modülü Order.shippedQty'i güncelleyip burayı tetikleyecek.
// =============================================================================

import { Prisma, OrderStatus } from "@prisma/client";

/**
 * Bir siparişin statusunu yeniden hesaplar.
 * Sevkiyat modülü yeniden yazılana kadar no-op döner.
 */
export async function recomputeOrderStatus(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<{ changed: boolean; oldStatus: OrderStatus; newStatus: OrderStatus } | null> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true },
  });
  if (!order) return null;
  return { changed: false, oldStatus: order.status, newStatus: order.status };
}

/**
 * Bir top'a bağlı tüm siparişlerin statusunu yeniden hesaplar.
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

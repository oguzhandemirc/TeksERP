// =============================================================================
// Sipariş status hesabı — tek noktadan yönetilen geçişler
// =============================================================================
// Sadeleşmiş yaşam döngüsü:
//   PENDING → APPROVED → PARTIAL_SHIPPED → COMPLETED
//                     → CANCELLED (manuel)
//
// Sevk muhasebesi: bir siparişin "sevk edilen" metrajı = o siparişin
// satırlarına etiketli (Roll.targetOrderLineId) ve status=SHIPPED olan
// topların currentQty toplamı. Çuval kapanınca toplar SHIPPED'a çekilir ve
// bu helper tetiklenir. Order.shippedQty denormalize alanı buradan güncellenir.
// =============================================================================

import { Prisma, OrderStatus, RollStatus } from "@prisma/client";
import { readShippingToleranceMeters } from "../system-setting.service";

/**
 * Bir siparişin shippedQty ve status'unu yeniden hesaplar.
 *
 * Kurallar:
 *   - shippedQty = SUM(Roll.currentQty | targetOrderLineId ∈ sipariş satırları, status=SHIPPED)
 *   - totalRequired = SUM(OrderLine.quantity)
 *   - shippedQty <= 0                                  → APPROVED
 *   - (totalRequired - shippedQty) <= tolerans          → COMPLETED
 *   - aksi                                              → PARTIAL_SHIPPED
 *
 * COMPLETED / CANCELLED terminal — değişmez. Transaction client kabul eder.
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
      lines: { select: { id: true, quantity: true } },
    },
  });
  if (!order) return null;

  // Terminal statüler değişmez
  if (
    order.status === OrderStatus.COMPLETED ||
    order.status === OrderStatus.CANCELLED
  ) {
    return { changed: false, oldStatus: order.status, newStatus: order.status };
  }

  const lineIds = order.lines.map((l) => l.id);

  // Sevk edilen metraj — siparişe etiketli + SHIPPED topların currentQty toplamı
  const shippedAgg = lineIds.length
    ? await tx.roll.aggregate({
        where: { targetOrderLineId: { in: lineIds }, status: RollStatus.SHIPPED },
        _sum: { currentQty: true },
      })
    : null;
  const shippedQty = shippedAgg?._sum.currentQty ?? new Prisma.Decimal(0);

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

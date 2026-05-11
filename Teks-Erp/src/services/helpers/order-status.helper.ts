// =============================================================================
// Sipariş status hesabı — tek noktadan yönetilen geçişler
// =============================================================================
// Sadeleşmiş yaşam döngüsü:
//   PENDING → APPROVED → PARTIAL_SHIPPED → COMPLETED
//                     → CANCELLED (manuel)
//
// Auto-flip sevk olaylarında olur:
//   shipped >= (requested - tolerance)    → COMPLETED  (fire payı kabul)
//   0 < shipped < (requested - tolerance) → PARTIAL_SHIPPED
//   shipped == 0                          → mevcut status korunur
//
// Tolerance değeri SystemSetting'ten okunur (default 5m). Tekstilde kesim
// fireleri normaldir; tam metraj nadiren tutar. Manuel kapatma ayrı
// orderService.manualComplete() endpoint'iyle yapılır — recomputeOrderStatus
// manuel kapatılmış siparişe (manualClosedById dolu) dokunmaz.
//
// CANCELLED siparişler hariç tutulur — manuel iptal sonradan kaldırılmaz.
// =============================================================================

import { Prisma, OrderStatus } from "@prisma/client";
import { readShippingToleranceMeters } from "../system-setting.service";

/**
 * Bir siparişin statusunu sevk sayaçlarına göre yeniden hesaplar.
 * - Sevkiyat finalize edildiğinde çağrılır (asıl tetikleyici).
 * - Allocation/çuval/tambur değişimlerinde de çağrılıyor — sevk olmadıkça
 *   no-op döner.
 *
 * Idempotent — aynı siparişe N kez çağrılması güvenli.
 * Status değişmiyorsa update yapılmaz.
 *
 * Manuel kapatılmış (manualClosedById dolu) sipariş tx'in bu çağrısında
 * korunur — sadece reopen ile geri açılır.
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
      manualClosedById: true,
      completedAt: true,
      lines: {
        select: {
          quantity: true,
          allocations: {
            select: {
              roll: {
                select: {
                  shipmentItems: {
                    where: { shipment: { status: "SHIPPED" } },
                    select: { shippedQty: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!order) return null;
  if (order.status === OrderStatus.CANCELLED) return null;
  // Manuel kapatılmış siparişe sevk sayaçları sebebiyle dokunma.
  if (order.manualClosedById) return null;

  let totalRequested = 0;
  let totalShipped = 0;

  for (const line of order.lines) {
    totalRequested += line.quantity;
    for (const a of line.allocations) {
      for (const si of a.roll.shipmentItems) {
        totalShipped += si.shippedQty;
      }
    }
  }

  const tolerance = await readShippingToleranceMeters(tx);
  const acceptedRequested = Math.max(0, totalRequested - tolerance);

  let next: OrderStatus = order.status;

  if (totalShipped >= acceptedRequested && totalRequested > 0) {
    next = OrderStatus.COMPLETED;
  } else if (totalShipped > 0) {
    next = OrderStatus.PARTIAL_SHIPPED;
  }
  // shipped == 0 → mevcut status korunur.

  if (next === order.status) {
    return { changed: false, oldStatus: order.status, newStatus: next };
  }

  await tx.order.update({
    where: { id: orderId },
    data: {
      status: next,
      // Otomatik COMPLETED'a düşerse completedAt'i set et (manualClosedById null kalır → otomatik kapatma)
      completedAt:
        next === OrderStatus.COMPLETED && !order.completedAt
          ? new Date()
          : undefined,
    },
  });

  return { changed: true, oldStatus: order.status, newStatus: next };
}

/**
 * Bir top'a bağlı tüm siparişlerin statusunu yeniden hesaplar.
 * Allocation transfer (top A'dan B'ye taşındı) sonrasında **iki sipariş** etkilenir;
 * çağıran kod "etkilenen tüm siparişler" listesini bilir; bu helper o listeyi alıp
 * tek tek `recomputeOrderStatus` çağırır.
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

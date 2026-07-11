// =============================================================================
// Sipariş karşılanma + status hesabı — tek noktadan yönetilen geçişler
// =============================================================================
// Sadeleşmiş yaşam döngüsü:
//   PENDING → APPROVED → PARTIAL_SHIPPED → COMPLETED
//                     → CANCELLED (manuel)
//
// KARŞILANMA (ÇUVAL HAVUZU MODELİ, top→sipariş bağı YOK): defter-otoritatif —
// increment/decrement YOK, denorm alanlar her seferinde defterden YENİDEN hesaplanır
// (drift-free). Bir OrderLine için:
//   shippedQty = Σ SackAllocation.qty (çuval DISPATCHED sevkiyatta) + Σ DirectShipAllocation.qty
//   packedQty  = Σ SackAllocation.qty (çuval havuzda VEYA PLANNED/AT_DOOR sevkiyatta)
// Order.shippedQty/packedQty bunların toplamı. Bu helper ledger değiştikten sonra
// (rebalance / dispatch / cancel / directShip) tetiklenir; her şeyi senkronlar.
// =============================================================================

import { Prisma, OrderStatus, ShipmentStatus } from "@prisma/client";
import { readShippingToleranceMeters } from "../system-setting.service";

/**
 * Verilen OrderLine satırlarını write-kilitle (karşılanma yazımını serileştirmek için).
 *
 * Neden: `OrderLine.shippedQty/packedQty` denormalize toplamlardır; birden fazla yol
 * (iki sevkiyatın dispatch'i, rebalance ile paralel fason directShip) aynı satırı
 * yeniden hesaplayabilir. Kapasite (`quantity - shipped - packed`) tx DIŞINDA okunup
 * tx İÇİNDE yazılırsa READ COMMITTED altında iki işlem birbirinin commit'ini görmez ve
 * `quantity`'yi aşar (over-coverage). Bu yardımcı kapasite TAZE okunmadan ÖNCE çağrılır:
 * ikinci işlem burada bloklanır, ilk commit'ten sonra güncel değeri okur.
 *
 * Deadlock güvenliği: ID'ler SIRALI kilitlenir. Set-bazlı tek UPDATE kilit sırasını
 * GARANTİ ETMEZ; o yüzden bilinçli id-başına döngü (ESLint `Promise.all(tx.*)` yasağına da uygun).
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
 * Verilen OrderLine satırları için defter-toplamları hesapla (shipped + packed).
 *   shipped = dispatched SackAllocation + directShip
 *   packed  = havuz VEYA PLANNED/AT_DOOR SackAllocation
 * groupBy — @@index([orderLineId]) sürer; sack.shipment.status join'i indexli.
 */
export async function computeLineLedger(
  tx: Prisma.TransactionClient,
  lineIds: string[]
): Promise<Map<string, { shipped: Prisma.Decimal; packed: Prisma.Decimal }>> {
  const result = new Map<string, { shipped: Prisma.Decimal; packed: Prisma.Decimal }>();
  const ids = [...new Set(lineIds)];
  if (ids.length === 0) return result;
  for (const id of ids) result.set(id, { shipped: new Prisma.Decimal(0), packed: new Prisma.Decimal(0) });

  // Sevk edilmiş çuval tahsisleri → shippedQty.
  const dispatched = await tx.sackAllocation.groupBy({
    by: ["orderLineId"],
    where: {
      orderLineId: { in: ids },
      sack: { shipment: { status: ShipmentStatus.DISPATCHED } },
    },
    _sum: { qty: true },
  });
  for (const r of dispatched) {
    result.get(r.orderLineId)!.shipped = result.get(r.orderLineId)!.shipped.plus(r._sum.qty ?? 0);
  }

  // Fason doğrudan sevk tahsisleri → shippedQty (Shipment'sız, terminaldir).
  const direct = await tx.subcontractorDirectShipAllocation.groupBy({
    by: ["orderLineId"],
    where: { orderLineId: { in: ids } },
    _sum: { qty: true },
  });
  for (const r of direct) {
    result.get(r.orderLineId)!.shipped = result.get(r.orderLineId)!.shipped.plus(r._sum.qty ?? 0);
  }

  // Havuzdaki + planlı/kapıdaki (henüz sevk edilmemiş) çuval tahsisleri → packedQty.
  const packed = await tx.sackAllocation.groupBy({
    by: ["orderLineId"],
    where: {
      orderLineId: { in: ids },
      OR: [
        { sack: { shipmentId: null } },
        { sack: { shipment: { status: { in: [ShipmentStatus.PLANNED, ShipmentStatus.AT_DOOR] } } } },
      ],
    },
    _sum: { qty: true },
  });
  for (const r of packed) {
    result.get(r.orderLineId)!.packed = result.get(r.orderLineId)!.packed.plus(r._sum.qty ?? 0);
  }

  return result;
}

/**
 * Bir siparişin karşılanma denormlarını (satır + header shippedQty/packedQty) defterden
 * YENİDEN HESAPLA ve status'unu güncelle.
 *
 * Status kuralları (yalnız GERÇEK sevkle ilerler; packedQty status'a girmez):
 *   - shippedQty <= 0                                  → APPROVED
 *   - (totalRequired - shippedQty) <= tolerans          → COMPLETED
 *   - aksi                                              → PARTIAL_SHIPPED
 *
 * CANCELLED terminal; manuel kapatılmış (manualClosedById dolu) COMPLETED terminal —
 * status'u değişmez ama denormları yine de güncel tutulur. Otomatik COMPLETED re-open
 * olabilir (sevk/tahsis geri alınınca). Tx kabul eder.
 */
export async function recomputeOrderStatus(
  tx: Prisma.TransactionClient,
  orderId: string,
  toleranceMeters?: number
): Promise<{ changed: boolean; oldStatus: OrderStatus; newStatus: OrderStatus } | null> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      completedAt: true,
      manualClosedById: true,
      lines: { select: { id: true, quantity: true } },
    },
  });
  if (!order) return null;

  const ledger = await computeLineLedger(tx, order.lines.map((l) => l.id));

  // Satır denormlarını yaz + header toplamlarını biriktir.
  let shippedQty = new Prisma.Decimal(0);
  let packedQty = new Prisma.Decimal(0);
  let totalRequired = new Prisma.Decimal(0);
  for (const l of order.lines) {
    const led = ledger.get(l.id) ?? { shipped: new Prisma.Decimal(0), packed: new Prisma.Decimal(0) };
    await tx.orderLine.update({
      where: { id: l.id },
      data: { shippedQty: led.shipped, packedQty: led.packed },
    });
    shippedQty = shippedQty.plus(led.shipped);
    packedQty = packedQty.plus(led.packed);
    totalRequired = totalRequired.plus(l.quantity);
  }

  // İptal terminal; manuel kapatılmış sipariş de terminal (kullanıcı kararı korunur).
  const terminal =
    order.status === OrderStatus.CANCELLED ||
    (order.status === OrderStatus.COMPLETED && order.manualClosedById != null);

  const tolerance = new Prisma.Decimal(
    toleranceMeters ?? (await readShippingToleranceMeters(tx))
  );

  let newStatus: OrderStatus = order.status;
  if (!terminal) {
    newStatus = OrderStatus.APPROVED;
    if (shippedQty.greaterThan(0)) {
      newStatus = totalRequired.minus(shippedQty).lessThanOrEqualTo(tolerance)
        ? OrderStatus.COMPLETED
        : OrderStatus.PARTIAL_SHIPPED;
    }
  }

  const changed = newStatus !== order.status;
  const data: Prisma.OrderUncheckedUpdateInput = { shippedQty, packedQty };
  if (changed) {
    data.status = newStatus;
    if (newStatus === OrderStatus.COMPLETED && !order.completedAt) {
      data.completedAt = new Date();
    }
    if (newStatus !== OrderStatus.COMPLETED && order.completedAt) {
      data.completedAt = null;
    }
  }
  await tx.order.update({ where: { id: orderId }, data });

  return { changed, oldStatus: order.status, newStatus };
}

/**
 * Birden çok siparişin karşılanmasını yeniden hesaplar (duplikatlar filtrelenir).
 * Sevk-tölerans ayarını BİR KEZ okur.
 */
export async function recomputeOrderStatusForOrders(
  tx: Prisma.TransactionClient,
  orderIds: string[]
): Promise<void> {
  const unique = [...new Set(orderIds)];
  if (unique.length === 0) return;
  const toleranceMeters = await readShippingToleranceMeters(tx);
  for (const id of unique) {
    await recomputeOrderStatus(tx, id, toleranceMeters);
  }
}

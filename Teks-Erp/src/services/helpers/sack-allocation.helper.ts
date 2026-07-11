// =============================================================================
// Çuval havuzu karşılanma dengeleyicisi — rebalanceCustomerPool
// =============================================================================
// Bir müşterinin ÇUVAL DEPO HAVUZUNDAKİ (shipmentId NULL, mühürlü) çuvallarını, açık
// sipariş satırlarına DETERMİNİSTİK çuval-farkındalı FIFO ile yeniden tahsis eder →
// SackAllocation defteri (havuz kısmı) sil-yaz. Sonra karşılanma denormlarını (packedQty
// + shippedQty + status) recompute eder.
//
// Değişmezler:
//   • YALNIZ havuz çuvallarının (shipmentId NULL) tahsisleri sil-yazılır. Sevkiyata
//     atanmış (PLANNED/AT_DOOR) veya sevk edilmiş (DISPATCHED) çuvalların tahsisleri
//     DONMUŞTUR — dokunulmaz.
//   • need(satır) = quantity − shippedQty − frozenPacked  (donmuş + sevk edilmiş düşülür;
//     havuz yalnız KALAN kapasiteyi doldurur → over-coverage imkânsız).
//   • Kilit: müşterinin açık satırları id-sıralı kilitlenir (touchOrderLinesTx) → iki
//     paralel rebalance aynı satır kümesinde doğal serileşir.
// =============================================================================

import { Prisma, OrderStatus, RollStatus } from "@prisma/client";
import {
  distributeSacksToLines,
  type PoolSack,
  type SackAllocLine,
} from "./allocation.helper";
import {
  touchOrderLinesTx,
  computeLineLedger,
  recomputeOrderStatusForOrders,
} from "./order-status.helper";

/**
 * Bir müşterinin çuval depo havuzunu açık siparişlerine yeniden dengele. Havuz
 * (shipmentId NULL) SackAllocation'larını sil-yazar, ardından etkilenen siparişleri
 * recompute eder. Tx İÇİNDE çağrılır (çağıran statü/mühür değişimini aynı tx'te yapar).
 */
export async function rebalanceCustomerPool(
  tx: Prisma.TransactionClient,
  customerId: string
): Promise<void> {
  // 1) Müşterinin açık siparişleri + satırları (spec + FIFO anahtarları + şube).
  const openOrders = await tx.order.findMany({
    where: {
      customerId,
      status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] },
    },
    select: {
      id: true,
      branchId: true,
      deadline: true,
      orderDate: true,
      lines: {
        select: { id: true, itemId: true, colorId: true, width: true, quantity: true, createdAt: true },
      },
    },
  });
  const openLineIds = openOrders.flatMap((o) => o.lines.map((l) => l.id));

  // 2) Kilit — açık satırları id-sıralı kilitle (paralel rebalance/dispatch serileşsin).
  await touchOrderLinesTx(tx, openLineIds);

  // 3) Silinmeden ÖNCE mevcut havuz tahsislerinin dokunduğu satırları topla (recompute
  //    kapsamı için — bir satırın havuz tahsisi kalkıp kapalı siparişe aitse bile senkron).
  const oldPoolAllocs = await tx.sackAllocation.findMany({
    where: { sack: { customerId, shipmentId: null } },
    select: { orderLineId: true },
  });
  const oldPoolLineIds = [...new Set(oldPoolAllocs.map((a) => a.orderLineId))];

  // 4) Havuz tahsislerini sil (yalnız bu müşterinin havuz çuvalları; donmuşlara dokunma).
  await tx.sackAllocation.deleteMany({ where: { sack: { customerId, shipmentId: null } } });

  // 5) Silme SONRASI defter = shipped (dispatched+direct) + frozen (PLANNED/AT_DOOR).
  //    Havuz tahsisi 0 olduğundan computeLineLedger.packed = yalnız donmuş kısım.
  const ledger = await computeLineLedger(tx, openLineIds);

  // 6) Havuzdaki mühürlü çuvalları içerikleriyle yükle (mühür sırasında FIFO).
  const poolSackRows = await tx.sack.findMany({
    where: { customerId, shipmentId: null, sealedAt: { not: null } },
    orderBy: [{ sealedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      branchId: true,
      rolls: {
        where: { status: RollStatus.WAREHOUSE },
        select: { itemId: true, colorId: true, width: true, currentQty: true },
      },
    },
  });
  const poolSacks: PoolSack[] = poolSackRows.map((s) => ({
    sackId: s.id,
    branchId: s.branchId,
    rolls: s.rolls.map((r) => ({
      itemId: r.itemId,
      colorId: r.colorId,
      width: r.width,
      currentQty: new Prisma.Decimal(r.currentQty),
    })),
  }));

  // 7) need = quantity − shipped − frozenPacked (havuzun dolduracağı kalan kapasite).
  const lines: SackAllocLine[] = openOrders.flatMap((o) =>
    o.lines.map((l) => {
      const led = ledger.get(l.id) ?? { shipped: new Prisma.Decimal(0), packed: new Prisma.Decimal(0) };
      const need = Prisma.Decimal.max(
        0,
        new Prisma.Decimal(l.quantity).minus(led.shipped).minus(led.packed)
      );
      return {
        id: l.id,
        itemId: l.itemId,
        colorId: l.colorId,
        width: l.width,
        branchId: o.branchId,
        need,
        deadline: o.deadline,
        orderDate: o.orderDate,
        lineCreatedAt: l.createdAt,
      };
    })
  );

  // 8) Çuval-farkındalı FIFO dağıt → yeni havuz tahsisleri.
  const allocations = distributeSacksToLines(poolSacks, lines);
  if (allocations.length > 0) {
    await tx.sackAllocation.createMany({
      data: allocations.map((a) => ({ sackId: a.sackId, orderLineId: a.orderLineId, qty: a.qty })),
    });
  }

  // 9) Etkilenen siparişleri recompute (yeni tahsis satırları + eski silinen satırlar).
  const touchedLineIds = [...new Set([...openLineIds, ...oldPoolLineIds])];
  if (touchedLineIds.length > 0) {
    const orderRows = await tx.orderLine.findMany({
      where: { id: { in: touchedLineIds } },
      select: { orderId: true },
    });
    const orderIds = [...new Set(orderRows.map((r) => r.orderId))];
    await recomputeOrderStatusForOrders(tx, orderIds);
  }
}

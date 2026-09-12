// =============================================================================
// Sipariş karşılanma + status hesabı — tek noktadan yönetilen geçişler
// =============================================================================
// Sadeleşmiş yaşam döngüsü:
//   PENDING → APPROVED → PARTIAL_SHIPPED → COMPLETED
//                     → CANCELLED (manuel)
//
// KARŞILANMA (ÇUVAL DEPO MODELİ, top→sipariş bağı YOK): defter-otoritatif —
// increment/decrement YOK, denorm alanlar her seferinde defterden YENİDEN hesaplanır
// (drift-free). Rezerv/packedQty YOK. Bir OrderLine için:
//   shippedQty = Σ SackAllocation.qty (çuval DISPATCHED sevkiyatta) + Σ DirectShipAllocation.qty
// Order.shippedQty bunun toplamı. Bu helper ledger değiştikten sonra
// (dispatch / cancel / directShip / sipariş düzenleme) tetiklenir; her şeyi senkronlar.
// =============================================================================

import { Prisma, OrderStatus, ShipmentStatus, ItemUnit } from "@prisma/client";
import { isMeasuredUnit, unitLabel } from "../../constants/item-unit";
import { readShippingToleranceMeters } from "../system-setting.service";

/**
 * Verilen OrderLine satırlarını write-kilitle (karşılanma yazımını serileştirmek için).
 *
 * Neden: `OrderLine.shippedQty` denormalize toplamdır; birden fazla yol
 * (iki sevkiyatın dispatch'i, paralel fason directShip) aynı satırı
 * yeniden hesaplayabilir. Kapasite (`quantity - shipped`) tx DIŞINDA okunup
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
 * Verilen OrderLine satırları için sevk defter-toplamını hesapla (shipped).
 *   shipped = dispatched SackAllocation + directShip
 * groupBy — @@index([orderLineId]) sürer; sack.shipment.status join'i indexli.
 * NOT: packedQty/rezerv YOK — havuz/planlı çuvallar hiçbir satıra sayılmaz (düşüş sevkte).
 */
export async function computeLineLedgerTx(
  tx: Prisma.TransactionClient,
  lineIds: string[]
): Promise<Map<string, { shipped: Prisma.Decimal }>> {
  const result = new Map<string, { shipped: Prisma.Decimal }>();
  const ids = [...new Set(lineIds)];
  if (ids.length === 0) return result;
  for (const id of ids) result.set(id, { shipped: new Prisma.Decimal(0) });

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

  return result;
}

/**
 * Bir siparişin karşılanma denormunu (satır + header shippedQty) defterden
 * YENİDEN HESAPLA ve status'unu güncelle.
 *
 * Status kuralları (yalnız GERÇEK sevkle ilerler):
 *   - shippedQty <= 0                                  → APPROVED
 *   - (totalRequired - shippedQty) <= tolerans          → COMPLETED
 *   - aksi                                              → PARTIAL_SHIPPED
 *
 * CANCELLED terminal; manuel kapatılmış (manualClosedById dolu) COMPLETED terminal —
 * status'u değişmez ama denormları yine de güncel tutulur. Otomatik COMPLETED re-open
 * olabilir (sevk geri alınınca). Tx kabul eder.
 */
export async function recomputeOrderStatusTx(
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
      lines: { select: { id: true, quantity: true, cancelledAt: true, unit: true } },
    },
  });
  if (!order) return null;

  const ledger = await computeLineLedgerTx(tx, order.lines.map((l) => l.id));

  // Satır denormunu yaz + header toplamını biriktir.
  //
  // ── İPTAL EDİLMİŞ KALEM (2026-08-27) ──────────────────────────────────────
  // Denorm YAZILIR (sevk defteri iptalden etkilenmez — mal çıktıysa çıkmıştır),
  // ama TOPLAMA `quantity` DEĞİL `shipped` girer. Gerekçe: iptal edilen kalemin
  // kalanı artık beklenmiyor; `quantity` toplamda kalsaydı sipariş o farkı
  // asla kapatamaz ve SONSUZA DEK "kısmi sevk" görünürdü.
  //   • hiç sevk görmemiş iptal kalem → toplama 0 katar (yok gibi)
  //   • 100 istenip 40 sevk edilip iptal edilen kalem → toplama 40 katar,
  //     yani o kalem "tam karşılandı" sayılır ve sipariş kapanabilir.
  let shippedQty = new Prisma.Decimal(0);
  let totalRequired = new Prisma.Decimal(0);
  let activeLineCount = 0;
  // MT-dışı (kg/adet) AKTİF satır var mı: sipariş KENDİLİĞİNDEN KAPANAMAZ.
  let unmeasuredActive = false;
  // MT-dışı satıra metre defteri yazılmış mı: "bir şey çıktı" gerçeği (kısmi sevk).
  let unmeasuredShipped = false;
  for (const l of order.lines) {
    // ── MT-DIŞI SATIR METRE DEFTERİNİN DIŞINDADIR ─────────────────────────
    // Defter (`SackAllocation.qty`) metre tutar; kg/adet satıra bu Σ yazılırsa
    // 1000 kg'lık sipariş ~1000 m'de sessizce kapanır. Bu satırda `shippedQty`
    // YAZILMAZ (yeni satırda 0, eski rakam varsa olduğu gibi kalır) ve header
    // Σ'ya 0 girer. `unit` seçilmemişse MT — bugünkü davranış.
    const measured = isMeasuredUnit(l.unit);
    const ledgerRow = ledger.get(l.id) ?? { shipped: new Prisma.Decimal(0) };
    const led = measured ? ledgerRow : { shipped: new Prisma.Decimal(0) };
    if (measured) {
      await tx.orderLine.update({
        where: { id: l.id },
        data: { shippedQty: led.shipped },
      });
    } else if (ledgerRow.shipped.greaterThan(0)) {
      unmeasuredShipped = true;
    }
    shippedQty = shippedQty.plus(led.shipped);
    // ⚠️ GEVŞEK karşılaştırma (`== null`) BİLİNÇLİ: alanı `select`'ine almayan
    // bir çağıran `undefined` gönderir ve KATI `=== null` orada FALSE döner —
    // yani TÜM kalemler iptal sayılır, `allLinesCancelled` tetiklenir ve sipariş
    // sevk yokken CANCELLED'a düşer. Ölçüldü: `test_helpers`in sahte tx'i tam
    // bunu yaptı ve dört senaryo birden bozuldu. Eksik bir alan, siparişi iptal
    // ettiremez — belirsizlikte AKTİF kabul edilir (önceki davranış).
    if (l.cancelledAt == null) {
      activeLineCount++;
      if (measured) totalRequired = totalRequired.plus(l.quantity);
      else unmeasuredActive = true;
    } else {
      totalRequired = totalRequired.plus(led.shipped);
    }
  }
  /**
   * TÜM kalemleri iptal edilmiş sipariş (kullanıcı kuralı, 2026-08-27):
   *   • bir şey sevk edilmişse → COMPLETED (iş yapıldı, gerisi istenmiyor)
   *   • hiç sevk yoksa        → CANCELLED (ortada iş kalmadı)
   *
   * ⚠️ `order.lines.length > 0` şart: kalemi HİÇ OLMAYAN sipariş (form
   * açılışında, kalemler eklenmeden önce) de "aktif kalem yok" durumundadır ve
   * onu iptal etmek yeni siparişi doğduğu anda öldürürdü.
   */
  const allLinesCancelled = order.lines.length > 0 && activeLineCount === 0;

  // İptal terminal; manuel kapatılmış sipariş de terminal (kullanıcı kararı korunur).
  const terminal =
    order.status === OrderStatus.CANCELLED ||
    (order.status === OrderStatus.COMPLETED && order.manualClosedById != null);

  const tolerance = new Prisma.Decimal(
    toleranceMeters ?? (await readShippingToleranceMeters(tx))
  );

  // "Bir şey sevk edildi" — metre Σ ya da MT-dışı satıra düşmüş defter satırı.
  const anyShipped = shippedQty.greaterThan(0) || unmeasuredShipped;

  let newStatus: OrderStatus = order.status;
  if (!terminal) {
    newStatus = OrderStatus.APPROVED;
    if (anyShipped) {
      // Ölçülmeyen aktif satır varken COMPLETED yalnız elle (manualComplete).
      newStatus =
        !unmeasuredActive && totalRequired.minus(shippedQty).lessThanOrEqualTo(tolerance)
          ? OrderStatus.COMPLETED
          : OrderStatus.PARTIAL_SHIPPED;
    }
    // Son aktif kalem de iptal edildiyse sipariş açık kalamaz.
    if (allLinesCancelled) {
      newStatus = anyShipped ? OrderStatus.COMPLETED : OrderStatus.CANCELLED;
    }
  }

  const changed = newStatus !== order.status;
  const data: Prisma.OrderUncheckedUpdateInput = { shippedQty };
  if (changed) {
    data.status = newStatus;
    // Kalem iptalleri yüzünden CANCELLED'a düşen siparişe de zaman damgası —
    // damgasız iptal İptal Karnesi'nden sessizce düşerdi.
    if (newStatus === OrderStatus.CANCELLED) data.cancelledAt = new Date();
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
 *
 * KİLİT PROTOKOLÜ: recompute defteri KİLİTSİZ okur ve shippedQty'yi yazar —
 * ÇAĞIRAN, bu çağrıdan önce etkilenen siparişlerin TAM satır kümesini
 * `touchOrderLinesTx` ile TEK sıralı partide kilitlemeli (alt-küme kilidi +
 * buradaki tam-küme yazımı = iki-parti edinim → deadlock riski; kilitsiz çağrı =
 * eşzamanlı terminal olaylarda lost-update). Uygulayanlar: performDispatchTx,
 * cancelShipment, subcontractor directShip.
 */
export async function recomputeOrderStatusForOrdersTx(
  tx: Prisma.TransactionClient,
  orderIds: string[]
): Promise<void> {
  const unique = [...new Set(orderIds)];
  if (unique.length === 0) return;
  const toleranceMeters = await readShippingToleranceMeters(tx);
  for (const id of unique) {
    await recomputeOrderStatusTx(tx, id, toleranceMeters);
  }
}

/**
 * MT-dışı AKTİF satırların "karşılama ölçülmüyor" uyarıları — sipariş
 * create/update/detay yanıtının `warnings` alanına gider. Sessiz yanlış yerine
 * görünür-ölçülmemiş: satır kg/adet ise metre defteri onu ölçemez.
 */
export function unmeasuredLineWarnings(
  lines: ReadonlyArray<{
    unit?: ItemUnit | null;
    cancelledAt?: Date | null;
    item?: { name: string } | null;
    customerItemName?: string | null;
  }>,
): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (l.cancelledAt != null || isMeasuredUnit(l.unit)) continue;
    const name = l.customerItemName?.trim() || l.item?.name || "Kalem";
    out.push(
      `"${name}" kalemi ${unitLabel(l.unit)} birimli — metre defteri karşılamayı ölçemez; ` +
        "sevk edilen miktar bu satıra yazılmaz ve sipariş kendiliğinden kapanmaz.",
    );
  }
  return out;
}

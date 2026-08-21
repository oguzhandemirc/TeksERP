// =============================================================================
// Test: SİPARİŞ İPTALİ → REFAKAT KARTI BAYAT (+ legacy softDelete bağ temizliği)
// Çalıştır: npx tsx scripts/test_order_cancel_card_dirty.ts
// =============================================================================
// KORUNAN İNVARİANT: refakat kartında SİPARİŞ bloğu + iş emri TİPİ basılıdır.
// Sipariş iptal edilip bağ koparıldığında sahadaki kâğıt artık olmayan bir
// siparişi gösterir → `TravelerCard.contentDirty` işaretlenmeli ("yeniden bas").
//
// 2026-08-21'e kadar `order.service` bu helper'ı HİÇ çağırmıyordu; oysa kardeş yol
// `workorder-link.service` bağ eklerken DE kaldırırken DE işaretliyordu (asimetri).
//
// İkinci konu — legacy `softDelete` (BaseController'ın DELETE yolu) yalnız
// `status === "PLANNED"` bağlarını koparıyordu ve tipi hiç düzeltmiyordu:
// sipariş iptal olduktan sonra geriye "Siparişe Özel" tipli ama hiçbir siparişe
// bağlı olmayan iş emri kalıyordu (`cancelWithActions` bunu 2026-08-21'de
// düzeltmişti, legacy yol düzeltmemişti). Kural artık ortak: iptal edilmiş
// siparişin bağı hiçbir CANLI iş emrinde kalmaz; CANCELLED/SUPERSEDED iş emri
// kapsam DIŞI (tarihçe).
//
// ⚠️ Bilinçli kapsam dışı: legacy `softDelete` IN_PROGRESS/COMPLETED bağlı
// siparişi hâlâ 409 ile REDDEDER (blocking guard). Bu test o guard'ın durduğunu
// da ölçer — "terminal olmayan tüm bağlar" kuralı bugün fiilen PLANNED'a eşittir.
// =============================================================================

import { TravelerCardStatus, WorkOrderStatus, WorkOrderType } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { OrderService } from "../src/services/order.service";
import { AppError } from "../src/utils/app-error";

// BaseService config zorunlu (route katmanındakiyle aynı satır — modül-üstü
// varsayılan yok; `order.routes.ts` de böyle kuruyor).
const orders = new OrderService({ modelName: "order", tableName: "ORDER", nestedCreateFields: ["lines"] });

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
async function expectErr(label: string, fn: () => Promise<unknown>, status: number): Promise<void> {
  let code: number | null = null;
  try { await fn(); } catch (e) { code = e instanceof AppError ? e.statusCode : -1; }
  check(label, code === status, `beklenen ${status}, gelen ${code ?? "(hata YOK)"}`);
}

const cardOf = (workOrderId: string) =>
  prisma.travelerCard.findUnique({
    where: { workOrderId },
    select: { contentDirty: true, status: true, updatedAt: true },
  });
const woOf = (id: string) =>
  prisma.workOrder.findUnique({ where: { id }, select: { type: true, status: true } });
const linkCount = (workOrderId: string) =>
  prisma.workOrderToOrderLine.count({ where: { workOrderId } });

async function main(): Promise<void> {
  const ts = Date.now();
  const woIds: string[] = [];
  const orderIds: string[] = [];

  const item = await prisma.item.create({
    data: { code: `TEST-OCCD-ITM-${ts}`, name: `TEST OCCD KUMAS ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const customer = await prisma.customer.create({
    data: { code: `TEST-OCCD-CUS-${ts}`, name: `TEST OCCD MUSTERI ${ts}` },
    select: { id: true },
  });

  /** İş emri + (istenirse) refakat kartı. Kart doğrudan yazılır: kimlik alanları
   *  (`cardNumber`/`barcode` = iş emri no) `TravelerCardService.createForWorkOrder`
   *  ile aynı sözleşme, ama snapshot/baskı yolu bu testin konusu değil. */
  const makeWo = async (opts: {
    tag: string;
    status?: WorkOrderStatus;
    type?: WorkOrderType;
    withTargetItem?: boolean;
    card?: { status: TravelerCardStatus; contentDirty: boolean } | null;
  }): Promise<string> => {
    const no = `TEST-OCCD-IE-${ts}-${opts.tag}`;
    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: no,
        status: opts.status ?? WorkOrderStatus.PLANNED,
        type: opts.type ?? WorkOrderType.ORDER_PRODUCTION,
        targetItemId: opts.withTargetItem === false ? null : item.id,
        targetQuantity: 500,
      },
      select: { id: true },
    });
    woIds.push(wo.id);
    if (opts.card !== null) {
      const c = opts.card ?? { status: TravelerCardStatus.ACTIVE, contentDirty: false };
      await prisma.travelerCard.create({
        data: { cardNumber: no, barcode: no, workOrderId: wo.id, status: c.status, contentDirty: c.contentDirty },
      });
    }
    return wo.id;
  };

  const makeOrder = async (tag: string): Promise<{ id: string; lineId: string }> => {
    const o = await prisma.order.create({
      data: {
        orderNumber: `TEST-OCCD-SIP-${ts}-${tag}`,
        customerId: customer.id,
        lines: { create: [{ itemId: item.id, quantity: 500, width: 150 }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    orderIds.push(o.id);
    return { id: o.id, lineId: o.lines[0]!.id };
  };

  try {
    // =========================================================================
    // A) cancelWithActions — UNLINK_ONLY (PLANNED iş emri)
    // =========================================================================
    const oA = await makeOrder("A");
    const woA = await makeWo({ tag: "A" });
    await prisma.workOrderToOrderLine.create({ data: { workOrderId: woA, orderLineId: oA.lineId, allocatedQty: 0 } });

    await orders.cancelWithActions(oA.id, [{ workOrderId: woA, action: "UNLINK_ONLY" }], undefined);
    check("A-1) bağ koparıldı", (await linkCount(woA)) === 0);
    check("A-2) ⭐ refakat kartı BAYAT işaretlendi", (await cardOf(woA))?.contentDirty === true);
    check("A-3) son bağ kalkınca tip STOK'a döndü", (await woOf(woA))?.type === WorkOrderType.STOCK_PRODUCTION);

    // =========================================================================
    // B) cancelWithActions — CONVERT_TO_STOCK (IN_PROGRESS, tek-sipariş)
    // =========================================================================
    const oB = await makeOrder("B");
    const woB = await makeWo({ tag: "B", status: WorkOrderStatus.IN_PROGRESS });
    await prisma.workOrderToOrderLine.create({ data: { workOrderId: woB, orderLineId: oB.lineId, allocatedQty: 0 } });

    await orders.cancelWithActions(oB.id, [{ workOrderId: woB, action: "CONVERT_TO_STOCK" }], undefined);
    check("B-1) bağ koparıldı", (await linkCount(woB)) === 0);
    check("B-2) ⭐ CONVERT_TO_STOCK dalında da kart BAYAT", (await cardOf(woB))?.contentDirty === true);
    check("B-3) tip STOK", (await woOf(woB))?.type === WorkOrderType.STOCK_PRODUCTION);

    // =========================================================================
    // C) cancelWithActions — zaten bayat kart + VOIDED kart
    // =========================================================================
    const oC = await makeOrder("C");
    const woDirty = await makeWo({ tag: "CD", card: { status: TravelerCardStatus.ACTIVE, contentDirty: true } });
    const woVoid = await makeWo({ tag: "CV", card: { status: TravelerCardStatus.VOIDED, contentDirty: false } });
    await prisma.workOrderToOrderLine.create({ data: { workOrderId: woDirty, orderLineId: oC.lineId, allocatedQty: 0 } });
    await prisma.workOrderToOrderLine.create({ data: { workOrderId: woVoid, orderLineId: oC.lineId, allocatedQty: 0 } });
    const dirtyBefore = (await cardOf(woDirty))!.updatedAt;

    await orders.cancelWithActions(
      oC.id,
      [
        { workOrderId: woDirty, action: "UNLINK_ONLY" },
        { workOrderId: woVoid, action: "UNLINK_ONLY" },
      ],
      undefined,
    );
    const dirtyAfter = (await cardOf(woDirty))!;
    check("C-1) ⭐ zaten bayat karta İKİNCİ yazma yok (updatedAt sabit)",
      dirtyAfter.contentDirty === true && dirtyAfter.updatedAt.getTime() === dirtyBefore.getTime());
    check("C-2) ⭐ VOIDED kart işaretlenmedi (basılacak kâğıt yok)", (await cardOf(woVoid))?.contentDirty === false);

    // =========================================================================
    // D) legacy softDelete — bağ + kart + tip
    // =========================================================================
    const oD = await makeOrder("D");
    const woD = await makeWo({ tag: "D" }); // PLANNED + ORDER_PRODUCTION + hedef kumaş
    const woDone = await makeWo({ tag: "DX", status: WorkOrderStatus.CANCELLED }); // TERMİNAL — dokunulmamalı
    const woNoItem = await makeWo({ tag: "DN", withTargetItem: false }); // hedef kumaş yok → tip çevrilemez
    await prisma.workOrderToOrderLine.create({ data: { workOrderId: woD, orderLineId: oD.lineId, allocatedQty: 0 } });
    await prisma.workOrderToOrderLine.create({ data: { workOrderId: woDone, orderLineId: oD.lineId, allocatedQty: 0 } });
    await prisma.workOrderToOrderLine.create({ data: { workOrderId: woNoItem, orderLineId: oD.lineId, allocatedQty: 0 } });

    const res = await orders.softDelete(oD.id, undefined);
    check("D-1) sipariş iptal edildi", res.success === true, res.message);
    check("D-2) canlı iş emrinin bağı koparıldı", (await linkCount(woD)) === 0);
    check("D-3) ⭐ legacy yolda da kart BAYAT", (await cardOf(woD))?.contentDirty === true);
    check("D-4) ⭐ son bağı kalkan ORDER iş emri STOK'a döndü", (await woOf(woD))?.type === WorkOrderType.STOCK_PRODUCTION);
    check("D-5) ⭐ CANCELLED iş emrinin bağına DOKUNULMADI (tarihçe)", (await linkCount(woDone)) === 1);
    check("D-6) hedef kumaşsız iş emrinin bağı koparıldı", (await linkCount(woNoItem)) === 0);
    check("D-7) ⭐ hedef kumaşsız iş emri ORDER tipinde KALDI (STOK değişmezi)",
      (await woOf(woNoItem))?.type === WorkOrderType.ORDER_PRODUCTION);
    check("D-8) hedef kumaşsız iş emrinin kartı da BAYAT", (await cardOf(woNoItem))?.contentDirty === true);

    const auditD = await prisma.systemLog.findFirst({
      where: { tableName: "ORDER", recordId: oD.id, action: "DELETE" },
      orderBy: { createdAt: "desc" },
      select: { newData: true },
    });
    const nd = auditD?.newData as { unlinkedWorkOrderCount?: number; typeChangedWorkOrderIds?: string[] } | null;
    check("D-9) audit: unlinkedWorkOrderCount CANLI bağları sayar (terminal hariç)", nd?.unlinkedWorkOrderCount === 2, JSON.stringify(nd?.unlinkedWorkOrderCount));
    check("D-10) audit: typeChangedWorkOrderIds yalnız gerçekten çevrileni listeler",
      Array.isArray(nd?.typeChangedWorkOrderIds) && nd!.typeChangedWorkOrderIds!.length === 1 && nd!.typeChangedWorkOrderIds![0] === woD,
      JSON.stringify(nd?.typeChangedWorkOrderIds));

    // =========================================================================
    // E) legacy softDelete — IN_PROGRESS bağlı sipariş hâlâ 409 (guard duruyor)
    // =========================================================================
    const oE = await makeOrder("E");
    const woE = await makeWo({ tag: "E", status: WorkOrderStatus.IN_PROGRESS });
    await prisma.workOrderToOrderLine.create({ data: { workOrderId: woE, orderLineId: oE.lineId, allocatedQty: 0 } });
    await expectErr("E-1) kontrol: IN_PROGRESS bağlı sipariş legacy yolda → 409", () => orders.softDelete(oE.id, undefined), 409);
    check("E-2) kontrol: red edilen çağrı kartı BAYATLATMADI", (await cardOf(woE))?.contentDirty === false);
  } finally {
    // Cleanup — test kendi yarattığını siler (FK sırası: kart → bağ → WO → sipariş).
    if (woIds.length) {
      await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: woIds } } });
    }
    if (orderIds.length) {
      await prisma.workOrderToOrderLine.deleteMany({ where: { orderLine: { orderId: { in: orderIds } } } });
    }
    if (woIds.length) await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    if (orderIds.length) {
      await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    await prisma.item.deleteMany({ where: { id: item.id } });
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

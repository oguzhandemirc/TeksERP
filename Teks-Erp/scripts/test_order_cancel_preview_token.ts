// =============================================================================
// SİPARİŞ İPTALİ — önizleme belirteci (V4c, patron telefonu)
// Çalıştır: npx tsx scripts/test_order_cancel_preview_token.ts
// =============================================================================
// `GET /orders/:id/cancel-preview` → `previewToken`; `POST /orders/:id/cancel` gövdesinde opsiyonel
// `expectedPreviewToken` tutmazsa 409 `CANCEL_PREVIEW_STALE` ve HİÇBİR şey uygulanmaz. Sınanan:
//   §1 saf fonksiyon: belirlenimli, sıra bağımsız, `exclude` düşer; önizleme iki kez aynı token
//   §2 token'sız iptal bugünkü davranış · eşleşen token ile iptal uygulanır
//   §3 ⭐ önizlemeden sonra iş emri durumu değişti / yeni iş emri bağlandı / kalem düzenlendi / aktif sevkiyat → 409,
//      sipariş CANCELLED değil, bağ ve tip yerinde
//   §4 ⭐ CANCEL_WO + bayat token → iş emri İPTAL EDİLMEDİ (tx öncesi adım da uygulanmaz)
//   §5 CANCEL_WO + taze token → uygulanır (tx içi kıyas kendi iptal ettiği iş emrini düşer)
//   §6 ⭐ tx içi kıyas: ön kontrolden sonra değişen durum kilit altında yakalanır; düşülen iş emri değişimi sayılmaz
//   §7 route gövdesi `expectedPreviewToken`ı servise geçirir
// Negatif sonda (2026-11-13, ölçüldü; md5 ile geri): ön kontrol kıyası kaldırılınca 10 ❌ (§3 9 · §4);
// `verifyTx` kıyası no-op → §6 1 ❌; `exclude` yok sayılınca §5 + §6 2 ❌.
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ShipmentStatus, WorkOrderStatus, WorkOrderType } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ACTIVE_ORDER_LINK } from "../src/services/helpers/order-link.helper";
import { OrderService } from "../src/services/order.service";
import { cancelPreviewToken, guardCancelPreview } from "../src/services/order/cancel-preview-token";
import { AppError } from "../src/utils/app-error";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const orders = new OrderService({ modelName: "order", tableName: "ORDER", nestedCreateFields: ["lines"] });

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return "OK"; } catch (e) { return e instanceof AppError ? `${e.statusCode}:${String((e.details as { code?: string } | undefined)?.code ?? "")}` : `ERR:${(e as Error).message.slice(0, 120)}`; }
}

async function main(): Promise<void> {
  const ts = Date.now();
  const woIds: string[] = [];
  const orderIds: string[] = [];
  const shipmentIds: string[] = [];
  const item = await prisma.item.create({ data: { code: `TEST-OCPT-ITM-${ts}`, name: `TEST OCPT KUMAS ${ts}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const customer = await prisma.customer.create({ data: { code: `TEST-OCPT-CUS-${ts}`, name: `TEST OCPT MUSTERI ${ts}` }, select: { id: true } });

  const makeWo = async (tag: string, status: WorkOrderStatus = WorkOrderStatus.PLANNED): Promise<string> => {
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `TEST-OCPT-IE-${ts}-${tag}`, status, type: WorkOrderType.ORDER_PRODUCTION, targetItemId: item.id, targetQuantity: 500 },
      select: { id: true },
    });
    woIds.push(wo.id);
    return wo.id;
  };
  const makeOrder = async (tag: string, woStatus: WorkOrderStatus | null = WorkOrderStatus.PLANNED): Promise<{ id: string; lineId: string; woId: string | null }> => {
    const o = await prisma.order.create({
      data: { orderNumber: `TEST-OCPT-SIP-${ts}-${tag}`, customerId: customer.id, lines: { create: [{ itemId: item.id, quantity: 500, width: 150 }] } },
      select: { id: true, lines: { select: { id: true } } },
    });
    orderIds.push(o.id);
    const lineId = o.lines[0]!.id;
    const woId = woStatus ? await makeWo(tag, woStatus) : null;
    if (woId) await prisma.workOrderToOrderLine.create({ data: { workOrderId: woId, orderLineId: lineId, allocatedQty: 0 } });
    return { id: o.id, lineId, woId };
  };
  const tokenOf = async (orderId: string): Promise<string> => ((await orders.getCancelPreview(orderId)).data as { previewToken: string }).previewToken;
  const orderStatus = async (id: string) => (await prisma.order.findUnique({ where: { id }, select: { status: true } }))?.status;
  const links = (woId: string) => prisma.workOrderToOrderLine.count({ where: { workOrderId: woId, ...ACTIVE_ORDER_LINK } });
  const wo = (id: string) => prisma.workOrder.findUnique({ where: { id }, select: { status: true, type: true } });
  const untouched = async (label: string, o: { id: string; woId: string | null }) => {
    const w = o.woId ? await wo(o.woId) : null;
    check(`${label} — hiçbir şey uygulanmadı (sipariş açık, bağ + tip yerinde)`,
      (await orderStatus(o.id)) !== "CANCELLED" && (!o.woId || ((await links(o.woId)) === 1 && w?.type === WorkOrderType.ORDER_PRODUCTION)), JSON.stringify(w));
  };

  try {
    // ── §1 saf fonksiyon + önizleme ─────────────────────────────────────────
    const base = { orderId: "o", contentVersion: "2026-01-01T00:00:00.000Z", workOrders: [{ id: "a", status: "PLANNED", isSoleOrder: true }, { id: "b", status: "IN_PROGRESS", isSoleOrder: false }], shipments: [{ id: "s", status: "PLANNED" }] };
    const t0 = cancelPreviewToken(base);
    check("§1 belirlenimli + biçim cp1.", t0 === cancelPreviewToken({ ...base }) && /^cp1\.[0-9a-f]{32}$/.test(t0), t0);
    check("§1 sıra bağımsız", t0 === cancelPreviewToken({ ...base, workOrders: [...base.workOrders].reverse() }));
    check("§1 durum değişimi token'ı değiştirir", t0 !== cancelPreviewToken({ ...base, workOrders: [{ ...base.workOrders[0]!, status: "IN_PROGRESS" }, base.workOrders[1]!] }));
    check("§1 exclude düşer", cancelPreviewToken(base, new Set(["b"])) === cancelPreviewToken({ ...base, workOrders: [base.workOrders[0]!] }));
    const o1 = await makeOrder("P");
    const p1 = await tokenOf(o1.id);
    check("§1 önizleme iki kez aynı token", !!p1 && p1 === (await tokenOf(o1.id)), p1);

    // ── §2 token'sız / eşleşen token ───────────────────────────────────────
    const oA = await makeOrder("A");
    check("§2 token'sız iptal bugünkü davranış", (await codeOf(() => orders.cancelWithActions(oA.id, [], undefined, {}))) === "OK" && (await orderStatus(oA.id)) === "CANCELLED");
    const oB = await makeOrder("B", WorkOrderStatus.IN_PROGRESS);
    const tB = await tokenOf(oB.id);
    const rB = await codeOf(() => orders.cancelWithActions(oB.id, [{ workOrderId: oB.woId!, action: "CONVERT_TO_STOCK" }], undefined, { expectedPreviewToken: tB }));
    check("§2 ⭐ eşleşen token ile iptal uygulanır", rB === "OK" && (await orderStatus(oB.id)) === "CANCELLED" && (await wo(oB.woId!))?.type === WorkOrderType.STOCK_PRODUCTION, rB);

    // ── §3 bayat önizleme → 409 ────────────────────────────────────────────
    const oC = await makeOrder("C");
    const tC = await tokenOf(oC.id);
    await prisma.workOrder.update({ where: { id: oC.woId! }, data: { status: WorkOrderStatus.IN_PROGRESS } });
    const rC = await codeOf(() => orders.cancelWithActions(oC.id, [], undefined, { expectedPreviewToken: tC }));
    check("§3 ⭐ iş emri durumu değişti → 409 CANCEL_PREVIEW_STALE", rC === "409:CANCEL_PREVIEW_STALE", rC);
    await untouched("§3 durum", oC);

    const oD = await makeOrder("D");
    const tD = await tokenOf(oD.id);
    const extra = await makeWo("D2");
    await prisma.workOrderToOrderLine.create({ data: { workOrderId: extra, orderLineId: oD.lineId, allocatedQty: 0 } });
    const rD = await codeOf(() => orders.cancelWithActions(oD.id, [], undefined, { expectedPreviewToken: tD }));
    check("§3 ⭐ yeni iş emri bağlandı → 409 CANCEL_PREVIEW_STALE", rD === "409:CANCEL_PREVIEW_STALE", rD);
    await untouched("§3 yeni bağ", oD);

    const oE = await makeOrder("E", null);
    const tE = await tokenOf(oE.id);
    await prisma.orderLine.update({ where: { id: oE.lineId }, data: { quantity: 600 } });
    const rE = await codeOf(() => orders.cancelWithActions(oE.id, [], undefined, { expectedPreviewToken: tE }));
    check("§3 ⭐ kalem düzenlendi (içerik sürümü) → 409 CANCEL_PREVIEW_STALE", rE === "409:CANCEL_PREVIEW_STALE", rE);
    await untouched("§3 içerik", oE);

    const oS = await makeOrder("S", null);
    const tS = await tokenOf(oS.id);
    const sh = await prisma.shipment.create({ data: { shipmentNo: `TEST-OCPT-SVK-${ts}`, customerId: customer.id, status: ShipmentStatus.PLANNED }, select: { id: true } });
    shipmentIds.push(sh.id);
    await prisma.shipmentOrder.create({ data: { shipmentId: sh.id, orderId: oS.id } });
    const rS = await codeOf(() => orders.cancelWithActions(oS.id, [], undefined, { expectedPreviewToken: tS }));
    check("§3 aktif sevkiyat eklendi → 409 CANCEL_PREVIEW_STALE", rS === "409:CANCEL_PREVIEW_STALE", rS);
    check("§3 rastgele token → 409 CANCEL_PREVIEW_STALE", (await codeOf(() => orders.cancelWithActions(o1.id, [], undefined, { expectedPreviewToken: "cp1.yanlis" }))) === "409:CANCEL_PREVIEW_STALE");
    await untouched("§3 rastgele", o1);

    // ── §4 CANCEL_WO + bayat token: tx öncesi iş emri iptali de YOK ─────────
    const oF = await makeOrder("F", WorkOrderStatus.IN_PROGRESS);
    const tF = await tokenOf(oF.id);
    await prisma.orderLine.update({ where: { id: oF.lineId }, data: { quantity: 650 } });
    const rF = await codeOf(() => orders.cancelWithActions(oF.id, [{ workOrderId: oF.woId!, action: "CANCEL_WO" }], undefined, { expectedPreviewToken: tF }));
    check("§4 ⭐ CANCEL_WO + bayat token → 409, iş emri İPTAL EDİLMEDİ", rF === "409:CANCEL_PREVIEW_STALE" && (await wo(oF.woId!))?.status === WorkOrderStatus.IN_PROGRESS, `${rF} ${JSON.stringify(await wo(oF.woId!))}`);

    // ── §5 CANCEL_WO + taze token ──────────────────────────────────────────
    const oG = await makeOrder("G", WorkOrderStatus.IN_PROGRESS);
    const tG = await tokenOf(oG.id);
    const rG = await codeOf(() => orders.cancelWithActions(oG.id, [{ workOrderId: oG.woId!, action: "CANCEL_WO" }], undefined, { expectedPreviewToken: tG }));
    check("§5 ⭐ CANCEL_WO + taze token uygulanır", rG === "OK" && (await orderStatus(oG.id)) === "CANCELLED" && (await wo(oG.woId!))?.status === WorkOrderStatus.CANCELLED, rG);

    // ── §6 tx içi kıyas (ön kontrol → değişim → kilit altında yakalanır) ───
    const oH = await makeOrder("H");
    const guard = await guardCancelPreview(oH.id, await tokenOf(oH.id));
    await prisma.workOrder.update({ where: { id: oH.woId! }, data: { status: WorkOrderStatus.IN_PROGRESS } });
    const rH = await codeOf(() => prisma.$transaction(async (tx) => { await guard.lockTx(tx); await guard.verifyTx(tx, []); }));
    check("§6 ⭐ ön kontrolden sonraki değişim tx içinde 409 CANCEL_PREVIEW_STALE", rH === "409:CANCEL_PREVIEW_STALE", rH);
    const rH2 = await codeOf(() => prisma.$transaction(async (tx) => { await guard.lockTx(tx); await guard.verifyTx(tx, [oH.woId!]); }));
    check("§6 kendi iptal ettiği iş emrinin değişimi sayılmaz", rH2 === "OK", rH2);
    const noop = await guardCancelPreview(oH.id, undefined);
    check("§6 token yoksa bekçi no-op", (await codeOf(() => prisma.$transaction(async (tx) => { await noop.lockTx(tx); await noop.verifyTx(tx, []); }))) === "OK");

    // ── §7 route ───────────────────────────────────────────────────────────
    const route = readFileSync(join(__dirname, "../src/routes/order.routes.ts"), "utf8");
    check("§7 route expectedPreviewToken'ı servise geçirir", /expectedPreviewToken: z\.string\(\)/.test(route) && /\{ reasonCode, reasonText, expectedPreviewToken \}/.test(route));
  } finally {
    if (shipmentIds.length) {
      await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    }
    if (orderIds.length) await prisma.workOrderToOrderLine.deleteMany({ where: { orderLine: { orderId: { in: orderIds } } } });
    if (woIds.length) {
      await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch((e) => check("temizlik iş emri", false, (e as Error).message.slice(0, 200)));
    }
    if (orderIds.length) {
      await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    await prisma.item.deleteMany({ where: { id: item.id } });
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

const blocked = hedefDbEngeli();
if (blocked) {
  console.error(`⛔ DURDURULDU — ${blocked}`);
  process.exitCode = 1;
} else {
  main().catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
}

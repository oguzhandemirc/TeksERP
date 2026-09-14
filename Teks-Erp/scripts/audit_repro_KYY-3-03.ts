// =============================================================================
// AUDIT REPRO — KYY-3-03: OrderLine/Order kilit sırası ABBA'sı.
//   • performDispatchTx / cancelShipment / undoDispatch : OrderLine(tam küme, id-sıralı) → Order
//   • cancelOrderLine                                   : OrderLine(TEK, iptal edilen) → OrderLine(tam küme) → Order
//   • order.update / reopen                             : Order → OrderLine(tam küme)   [protokol İHLALİ]
// `order-status.helper.ts:203-211` protokolü tam-küme sıralı kilitlemeyi ZORUNLU kılar;
// üç çağıran uymuyor.
// Ortam: SADECE dev DB. Beklenen (sağlıklı sistem): 0 deadlock, 0 beklenmeyen 5xx.
// Gözlenen: audit/repro/KYY-3-03.log
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_KYY-3-03.ts
// @temizlik-scripti: denetim repro'su: silme, önceki kesilmiş koşumun KENDİ damgasını süpürer ve turlar arasında senaryoyu sıfırlar — sonda değil ÖN KOŞUL
// =============================================================================
import "dotenv/config";
function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production") throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "", db = "";
  try { const u = new URL(url); host = u.hostname.toLowerCase(); db = decodeURIComponent(u.pathname.replace(/^\//, "")); } catch { throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)"); }
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db") throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();
import prisma, { pool } from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";
import { orderService } from "../src/routes/order.routes";
import { ensureTestAdmin } from "./fixture-test-user";

const STAMP = `AUDITREPRO-KYY303-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
const info = (e: unknown) => {
  const err = e as { message?: string; code?: string; name?: string };
  return `${err?.name ?? "?"}/${err?.code ?? "-"}: ${(err?.message ?? String(e)).slice(0, 420).replace(/\s+/g, " ")}`;
};

async function main(): Promise<void> {
  console.log(`=== AUDIT REPRO KYY-3-03 — damga ${STAMP} ===`);
  const admin = await ensureTestAdmin();
  // Önceki (kesilmiş) koşumdan kalan KENDİ damgamı süpür — yalnız AUDITREPRO-KYY303-*.
  const eski = await prisma.customer.findMany({ where: { code: { startsWith: "AUDITREPRO-KYY303-" } }, select: { id: true } });
  for (const c of eski) {
    await prisma.sackAllocation.deleteMany({ where: { sack: { customerId: c.id } } });
    await prisma.shipmentOrder.deleteMany({ where: { order: { customerId: c.id } } });
    await prisma.roll.deleteMany({ where: { sack: { customerId: c.id } } });
    await prisma.sack.deleteMany({ where: { customerId: c.id } });
    await prisma.shipment.deleteMany({ where: { customerId: c.id } });
    await prisma.orderLine.deleteMany({ where: { order: { customerId: c.id } } });
    await prisma.order.deleteMany({ where: { customerId: c.id } });
    await prisma.customer.deleteMany({ where: { id: c.id } });
  }
  const customer = await prisma.customer.create({ data: { code: `${STAMP}-C`, name: `${STAMP} MUSTERI` }, select: { id: true } });
  const item = await prisma.item.create({ data: { code: `${STAMP}-I`, name: `${STAMP} KUMAS`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const color = await prisma.color.create({ data: { code: `${STAMP}-K`, name: `${STAMP} EKRU` }, select: { id: true } });
  const order = await prisma.order.create({ data: { orderNumber: `${STAMP}-O`, customerId: customer.id, status: "APPROVED" }, select: { id: true } });

  // 6 kalem → kilit sırası uzun; iptal edilecek kalem id sıralamasında EN SONDA
  // olsun ki dispatch'in tam-küme kilidiyle ters sıra kesin oluşsun.
  const lines: { id: string }[] = [];
  for (let i = 0; i < 6; i++) {
    lines.push(await prisma.orderLine.create({ data: { orderId: order.id, itemId: item.id, colorId: color.id, quantity: 100, width: 300 + i }, select: { id: true } }));
  }
  const sorted = [...lines].map((l) => l.id).sort();
  const target = sorted[sorted.length - 1]; // id sıralamasında SON kalem
  const allocLineId = sorted[0];            // dispatch bu satıra tahsis yazar

  const shipment = await prisma.shipment.create({ data: { shipmentNo: `${STAMP}-S`, customerId: customer.id, status: "PLANNED", destination: "DOMESTIC" }, select: { id: true } });
  const sack = await prisma.sack.create({ data: { sackNo: `${STAMP}-CV`, customerId: customer.id, shipmentId: shipment.id, seq: 1, weightKg: 40 }, select: { id: true } });
  await prisma.roll.create({ data: { barcode: `${STAMP}-R1`, itemId: item.id, colorId: color.id, status: "WAREHOUSE", currentQty: 50, initialQty: 50, width: 300, entrySource: "SUPPLIER_RECEIPT", shipmentId: shipment.id, sackId: sack.id } });
  await prisma.shipmentOrder.create({ data: { shipmentId: shipment.id, orderId: order.id, isActive: true } });
  await prisma.sackAllocation.create({ data: { sackId: sack.id, orderLineId: allocLineId, qty: 50 } });

  const resetRound = async () => {
    await prisma.printedDocument.deleteMany({ where: { sourceId: shipment.id } });
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: "PLANNED", dispatchedAt: null } });
    await prisma.sack.update({ where: { id: sack.id }, data: { shipmentId: shipment.id, seq: 1 } });
    await prisma.roll.updateMany({ where: { sackId: sack.id }, data: { shipmentId: shipment.id, status: "WAREHOUSE", preShipStatus: null } });
    await prisma.orderLine.updateMany({ where: { orderId: order.id }, data: { cancelledAt: null, cancelledById: null, cancelReason: null, cancelReasonCode: null, shippedQty: 0 } });
    await prisma.order.update({ where: { id: order.id }, data: { status: "APPROVED", shippedQty: 0, completedAt: null } });
  };

  const deadlockIzleri: string[] = [];
  let tur = 0;
  try {
    console.log("\n[A] dispatchShipment ∥ cancelOrderLine — 30 tur (ters kilit sırası)");
    for (let i = 0; i < 30; i++) {
      await resetRound();
      tur++;
      const res = await Promise.allSettled([
        shippingService.dispatchShipment(shipment.id, { plateNumber: "34AUD03" }, admin.id),
        orderService.cancelOrderLine(order.id, target, admin.id, { reasonText: `${STAMP} kalem iptali` }),
      ]);
      for (const r of res) {
        if (r.status === "rejected") {
          const t = info(r.reason);
          if (/deadlock|40P01|P2034|çakış/i.test(t)) deadlockIzleri.push(`tur ${i + 1}: ${t}`);
          else if (!/bu sırada|yenile|iptal edildi/i.test(t)) deadlockIzleri.push(`tur ${i + 1}: [BEKLENMEYEN] ${t}`);
        }
      }
    }
    if (deadlockIzleri.length) deadlockIzleri.slice(0, 8).forEach((l) => console.log(`   ⚠️ ${l}`));
    check("dispatch ∥ kalem iptali deadlock/çakışma üretmiyor", deadlockIzleri.length === 0, `${deadlockIzleri.length}/${tur} tur`);

    console.log("\n[B] dispatchShipment ∥ order.reopen — 20 tur (Order → OrderLine ters sıra)");
    const dl2: string[] = [];
    for (let i = 0; i < 20; i++) {
      await resetRound();
      await prisma.order.update({ where: { id: order.id }, data: { manualClosedById: admin.id, manualCloseReason: `${STAMP}`, status: "COMPLETED" } });
      const res = await Promise.allSettled([
        shippingService.dispatchShipment(shipment.id, { plateNumber: "34AUD04" }, admin.id),
        orderService.reopen(order.id, `${STAMP} yeniden ac`, admin.id),
      ]);
      for (const r of res) {
        if (r.status === "rejected") {
          const t = info(r.reason);
          if (/deadlock|40P01|P2034|çakış/i.test(t)) dl2.push(`tur ${i + 1}: ${t}`);
          else if (!/bu sırada|yenile|manuel kapat/i.test(t)) dl2.push(`tur ${i + 1}: [BEKLENMEYEN] ${t}`);
        }
      }
      // Lost-update ölçümü: sevk başarılıysa satır defterle uyumlu mu?
      const st = (await prisma.shipment.findUnique({ where: { id: shipment.id }, select: { status: true } }))!.status;
      const l = (await prisma.orderLine.findUnique({ where: { id: allocLineId }, select: { shippedQty: true } }))!;
      if (st === "DISPATCHED" && Number(l.shippedQty) !== 50) {
        dl2.push(`tur ${i + 1}: [LOST UPDATE] sevkiyat DISPATCHED ama shippedQty=${Number(l.shippedQty)} (beklenen 50)`);
      }
    }
    if (dl2.length) dl2.slice(0, 8).forEach((l) => console.log(`   ⚠️ ${l}`));
    check("dispatch ∥ reopen deadlock/lost-update üretmiyor", dl2.length === 0, `${dl2.length}/20 tur`);
    await prisma.order.update({ where: { id: order.id }, data: { manualClosedById: null, manualCloseReason: null } });
  } finally {
    console.log("\n--- temizlik ---");
    await prisma.printedDocument.deleteMany({ where: { sourceId: shipment.id } });
    await prisma.sackAllocation.deleteMany({ where: { sackId: sack.id } });
    await prisma.shipmentOrder.deleteMany({ where: { orderId: order.id } });
    await prisma.rollVariance.deleteMany({ where: { roll: { itemId: item.id } } });
    await prisma.roll.deleteMany({ where: { itemId: item.id } });
    await prisma.sack.deleteMany({ where: { customerId: customer.id } });
    await prisma.shipment.deleteMany({ where: { customerId: customer.id } });
    await prisma.orderLine.deleteMany({ where: { orderId: order.id } });
    await prisma.order.deleteMany({ where: { id: order.id } });
    await prisma.color.deleteMany({ where: { id: color.id } });
    await prisma.item.deleteMany({ where: { id: item.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [shipment.id, order.id, target] } } });
  }
  console.log(`\n=== Sonuç: ${pass} korundu, ${fail} İHLAL ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); await pool.end(); process.exit(1); });

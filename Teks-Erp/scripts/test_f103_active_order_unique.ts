// =============================================================================
// Test: F103 — bir sipariş aynı anda yalnız bir aktif sevkiyatta (partial unique
// shipment_orders_active_order_uq) + app-code isActive bakımı.
// Çalıştır: npx tsx scripts/test_f103_active_order_unique.ts
//   1. 2 paralel createShipment(aynı sipariş) → tam 1 başarılı, 1 × 409 (kilitsiz;
//      DB seddi + P2002-catch). DB'de o siparişe aktif shipment_order = 1.
//   2. cancelShipment → shipment_orders.isActive=false → sipariş yeniden sevk edilebilir.
// =============================================================================
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const shipping = new ShippingService();

async function makeOrder(ts: number, suffix: string): Promise<{ orderId: string; customerId: string }> {
  const cust = await prisma.customer.create({ data: { code: `TEST-F103-${suffix}-${ts}`, name: `TEST F103 ${suffix}` }, select: { id: true } });
  const item = await prisma.item.findFirst({ where: { itemType: "FABRIC", isActive: true }, select: { id: true } });
  const order = await prisma.order.create({
    data: { orderNumber: `TEST-F103-${suffix}-${ts}`, customerId: cust.id, status: "PENDING", lines: { create: [{ itemId: item!.id, quantity: 10 }] } },
    select: { id: true },
  });
  return { orderId: order.id, customerId: cust.id };
}

async function activeOrderCount(orderId: string): Promise<number> {
  return prisma.shipmentOrder.count({ where: { orderId, isActive: true } });
}

async function main() {
  const ts = Date.now();
  const custIds: string[] = [];
  const orderIds: string[] = [];
  const shipmentIds: string[] = [];

  try {
    // ── 1) Paralel createShipment yarışı ───────────────────────────────────
    const o1 = await makeOrder(ts, "A");
    custIds.push(o1.customerId); orderIds.push(o1.orderId);

    const results = await Promise.allSettled([
      shipping.createShipment({ orderIds: [o1.orderId] }),
      shipping.createShipment({ orderIds: [o1.orderId] }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const conflicts = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof AppError && r.reason.statusCode === 409,
    ).length;
    check("1) 2 paralel createShipment → tam 1 başarılı", ok === 1, `başarılı=${ok}`);
    check("1) diğeri 409 conflict (DB seddi + P2002-catch)", conflicts === 1, `409=${conflicts}`);
    check("1) DB'de o siparişe aktif shipment_order = 1 (çift-bağ yok)", (await activeOrderCount(o1.orderId)) === 1);

    // yaratılan sevkiyat(lar)ı topla
    const sos = await prisma.shipmentOrder.findMany({ where: { orderId: o1.orderId }, select: { shipmentId: true } });
    for (const s of sos) if (!shipmentIds.includes(s.shipmentId)) shipmentIds.push(s.shipmentId);

    // ── 2) cancel → isActive=false → yeniden sevk edilebilir ────────────────
    const o2 = await makeOrder(ts, "B");
    custIds.push(o2.customerId); orderIds.push(o2.orderId);

    const created = await shipping.createShipment({ orderIds: [o2.orderId] });
    const shipId = (created.data as { id: string }).id;
    shipmentIds.push(shipId);
    check("2) create sonrası aktif shipment_order = 1", (await activeOrderCount(o2.orderId)) === 1);

    // aynı siparişe 2. sevkiyat → engellenmeli (henüz aktif)
    let blocked = false;
    try { await shipping.createShipment({ orderIds: [o2.orderId] }); }
    catch (e) { blocked = e instanceof AppError && e.statusCode === 409; }
    check("2) aktifken 2. sevkiyat engellendi (409)", blocked);

    // iptal et → isActive=false olmalı
    await shipping.cancelShipment(shipId);
    check("2) cancel sonrası aktif shipment_order = 0 (isActive=false)", (await activeOrderCount(o2.orderId)) === 0);

    // artık yeniden sevk edilebilir
    const reship = await shipping.createShipment({ orderIds: [o2.orderId] });
    const reshipId = (reship.data as { id: string }).id;
    shipmentIds.push(reshipId);
    check("2) iptal sonrası sipariş YENİDEN sevk edilebilir", reship.success === true && !!reshipId);
  } finally {
    // Cleanup
    for (const sid of shipmentIds) {
      await prisma.shipmentOrder.deleteMany({ where: { shipmentId: sid } });
      await prisma.shipmentAllocation.deleteMany({ where: { shipmentId: sid } });
      await prisma.roll.updateMany({ where: { shipmentId: sid }, data: { shipmentId: null, sackId: null } });
      await prisma.shipment.deleteMany({ where: { id: sid } });
    }
    await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: custIds } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
}

main();

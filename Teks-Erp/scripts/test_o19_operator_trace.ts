// =============================================================================
// Test: O-19 — sevkiyat operatör izi (Sack.weighedById/weighedAt).
// Çalıştır: npx tsx scripts/test_o19_operator_trace.ts
//   1. updateSack tartı → weighedById=userId + weighedAt set.
//   2. addSack açılışta tartıyla → weighedById set (updateSack ile parite).
//   3. Yeniden tartı (updateSack) → en son tartan kazanır.
//   4. İçerik değişince (roll çıkar → resetSackWeightsTx) → weighedById/weighedAt temizlenir.
// Not: markReady→readyById + dispatch→dispatchedById akışları test_shipment_lifecycle'da
//   egzersiz edilir (O-19 sonrası 28/0 geçiyor).
// =============================================================================
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const shipping = new ShippingService();

async function main() {
  const ts = Date.now();
  const custIds: string[] = [];
  const orderIds: string[] = [];
  const shipmentIds: string[] = [];
  const rollIds: string[] = [];

  try {
    const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
    const admin2 = await prisma.user.findFirst({ where: { username: { not: "admin" } }, select: { id: true } });
    const uid1 = admin!.id;
    const uid2 = admin2?.id ?? admin!.id;

    const item = await prisma.item.findFirst({ where: { itemType: "FABRIC", isActive: true }, select: { id: true } });
    const cust = await prisma.customer.create({ data: { code: `TEST-O19-${ts}`, name: "TEST O19" }, select: { id: true } });
    custIds.push(cust.id);
    const order = await prisma.order.create({
      data: { orderNumber: `TEST-O19-${ts}`, customerId: cust.id, status: "PENDING", lines: { create: [{ itemId: item!.id, quantity: 10 }] } },
      select: { id: true },
    });
    orderIds.push(order.id);
    const shipRes = await shipping.createShipment({ orderIds: [order.id] });
    const shipmentId = (shipRes.data as { id: string }).id;
    shipmentIds.push(shipmentId);

    // ── 1) updateSack tartı → weighedById ──────────────────────────────────
    const sackRes = await shipping.addSack({ shipmentId, sackNo: `TEST-O19-S1-${ts}` });
    const sack1 = (sackRes.data as { id: string }).id;
    await shipping.updateSack({ sackId: sack1, weightKg: 50 }, uid1);
    let s = await prisma.sack.findUnique({ where: { id: sack1 }, select: { weighedById: true, weighedAt: true } });
    check("1) updateSack tartı → weighedById=userId + weighedAt set", s?.weighedById === uid1 && s?.weighedAt != null, `weighedById=${s?.weighedById === uid1}`);

    // ── 3) yeniden tartı → en son tartan ───────────────────────────────────
    await shipping.updateSack({ sackId: sack1, weightKg: 60 }, uid2);
    s = await prisma.sack.findUnique({ where: { id: sack1 }, select: { weighedById: true } });
    check("3) yeniden tartı → en son tartan kazanır", s?.weighedById === uid2);

    // ── 2) addSack açılışta tartıyla → weighedById ─────────────────────────
    const sack2Res = await shipping.addSack({ shipmentId, sackNo: `TEST-O19-S2-${ts}`, weightKg: 30 }, uid1);
    const sack2 = (sack2Res.data as { id: string }).id;
    s = await prisma.sack.findUnique({ where: { id: sack2 }, select: { weighedById: true, weighedAt: true } });
    check("2) addSack açılış tartısı → weighedById set (parite)", s?.weighedById === uid1 && s?.weighedAt != null);

    // ── 4) içerik değişince tartan izi temizlenir ──────────────────────────
    // WAREHOUSE top üret → sack1'e okut → çıkar (resetSackWeightsTx tetiklenir).
    const roll = await prisma.roll.create({
      data: { barcode: `TESTO19${ts}`, itemId: item!.id, initialQty: "40.000", currentQty: "40.000", qualityGrade: "1. Kalite", status: "WAREHOUSE" },
      select: { id: true, barcode: true },
    });
    rollIds.push(roll.id);
    await shipping.scanIntoShipment({ shipmentId, barcode: roll.barcode!, sackId: sack1 });
    // sack1'i yeniden tart (okutma sıfırlamış olabilir), sonra topu çıkar
    await shipping.updateSack({ sackId: sack1, weightKg: 70 }, uid1);
    let before = await prisma.sack.findUnique({ where: { id: sack1 }, select: { weighedById: true } });
    await shipping.removeRollFromShipment({ shipmentId, rollId: roll.id });
    const after = await prisma.sack.findUnique({ where: { id: sack1 }, select: { weighedById: true, weighedAt: true, weightKg: true } });
    check(
      "4) içerik değişince (roll çıkar) → weighedById/weighedAt/weightKg temizlendi",
      before?.weighedById === uid1 && after?.weighedById === null && after?.weighedAt === null && after?.weightKg === null,
      `önce=${before?.weighedById === uid1} sonra-null=${after?.weighedById === null}`,
    );
  } finally {
    for (const rid of rollIds) {
      await prisma.roll.updateMany({ where: { id: rid }, data: { shipmentId: null, sackId: null } });
      await prisma.roll.deleteMany({ where: { id: rid } });
    }
    for (const sid of shipmentIds) {
      await prisma.roll.updateMany({ where: { shipmentId: sid }, data: { shipmentId: null, sackId: null } });
      await prisma.sack.deleteMany({ where: { shipmentId: sid } });
      await prisma.shipmentOrder.deleteMany({ where: { shipmentId: sid } });
      await prisma.shipmentAllocation.deleteMany({ where: { shipmentId: sid } });
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

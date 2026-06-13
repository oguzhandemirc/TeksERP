// =============================================================================
// Test: Saha #7 — sevkiyat yeniden hedefleme (bağlı sipariş kümesini değiştir)
// Çalıştır: npx tsx scripts/test_shipment_retarget.ts
// Doğrulananlar:
//   1. PREPARING'de retarget sipariş kümesini replace eder
//   2. READY'de retarget: eski siparişin shippedQty'si düşer, yeniye yazılır (reverse+recommit)
//   3. Farklı müşteri siparişi reddedilir (400)
//   4. DISPATCHED retarget reddedilir (409)
// =============================================================================
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, code: number, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) { check(label, (e as { statusCode?: number }).statusCode === code); }
}

// ---------------------------------------------------------------------------
// Saha #7 (artımlı) — previewRetargetOrders SALT-OKUNUR önizleme süiti
// ---------------------------------------------------------------------------
async function previewSuite(
  ship: ShippingService,
  customerId: string,
  itemId: string,
  otherCustomerId: string,
  ts: number
): Promise<void> {
  // Kendi fixture'ı (mevcut testlerin kayıtlarına dokunmaz).
  const mkOrder = async (cust: string, n: number, qty: number) => {
    const o = await prisma.order.create({
      data: {
        orderNumber: `TEST-RTGP-${ts}-${n}`,
        customerId: cust,
        status: "APPROVED",
        orderDate: new Date(),
        lines: { create: [{ itemId, quantity: qty, width: 150 }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    return { id: o.id, lineId: o.lines[0].id };
  };
  const shippedQty = async (lineId: string) =>
    Number((await prisma.orderLine.findUnique({ where: { id: lineId }, select: { shippedQty: true } }))!.shippedQty);
  const allocCount = async (shipmentId: string) =>
    prisma.shipmentAllocation.count({ where: { shipmentId } });

  // P (committed hedef, qty 300 → 150m ile KISMİ kalır = geçerli aday sürer),
  // Q/Z yeni adaylar (qty 100 — küme genişletme).
  const P = await mkOrder(customerId, 10, 300);
  const Q = await mkOrder(customerId, 11, 100);
  const Z = await mkOrder(customerId, 12, 100);
  const foreign = await mkOrder(otherCustomerId, 13, 100);

  // READY (commit'li) sevkiyat — 150m WAREHOUSE top P'ye bağlı (commit→P shippedQty=150, KISMİ).
  const shipment = await prisma.shipment.create({
    data: { shipmentNo: `TEST-RTGP-${ts}`, customerId, status: "PREPARING", orders: { create: [{ orderId: P.id }] } },
    select: { id: true },
  });
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-RTGP-R-${ts}`, itemId, status: "WAREHOUSE", currentQty: 150, initialQty: 150,
      width: 150, qualityGrade: "A", entrySource: "SUPPLIER_RECEIPT", shipmentId: shipment.id,
    },
    select: { id: true },
  });
  const sack = (await ship.addSack({ shipmentId: shipment.id })).data as { id: string };
  await prisma.roll.update({ where: { id: roll.id }, data: { sackId: sack.id } });
  await ship.updateSack({ sackId: sack.id, weightKg: 40, manualCode: `RTGP${ts}` });
  await ship.markReady(shipment.id);
  check("önizleme fixture: READY commit P shippedQty=150 (kısmi)", (await shippedQty(P.lineId)) === 150);

  type Preview = {
    editable: boolean;
    orders: { orderId: string; orderNumber: string; planned: number; alreadyShipped: number; projected: number; coveragePct: number }[];
    totals: { goods: number; projectedTotal: number; leftover: number };
    ignored: { orderNumber: string; reason: string }[];
  };
  const preview = async (ids: string[]): Promise<Preview> =>
    ((await ship.previewRetargetOrders(shipment.id, ids)).data as Preview);
  const projOf = (p: Preview, orderId: string) => p.orders.find((o) => o.orderId === orderId)?.projected ?? 0;

  // (a) SALT-OKUNUR: preview hiçbir shippedQty / allocation değiştirmemeli.
  const pBefore = await shippedQty(P.lineId);
  const qBefore = await shippedQty(Q.lineId);
  const allocBefore = await allocCount(shipment.id);
  await preview([Q.id]);
  await preview([P.id, Q.id, Z.id]);
  await preview([foreign.id]);
  check("(a) SALT-OKUNUR: P.shippedQty değişmedi", (await shippedQty(P.lineId)) === pBefore, String(pBefore));
  check("(a) SALT-OKUNUR: Q.shippedQty değişmedi", (await shippedQty(Q.lineId)) === qBefore, String(qBefore));
  check("(a) SALT-OKUNUR: allocation sayısı değişmedi", (await allocCount(shipment.id)) === allocBefore, String(allocBefore));

  // (c) Aday kümeyi değiştirince projeksiyon değişir.
  const pvQ = await preview([Q.id]);
  const pvQZ = await preview([Q.id, Z.id]);
  const qOnly = projOf(pvQ, Q.id);
  const qWithZ = projOf(pvQZ, Q.id);
  const zWithZ = projOf(pvQZ, Z.id);
  // Tek aday Q: 150m hepsi Q'ya (need 100 → 100 düşer, 50 fazla). Q+Z: 100 Q'ya, 50 Z'ye (FIFO).
  check("(c) {Q}: Q projeksiyon 100", qOnly === 100, String(qOnly));
  check("(c) {Q,Z}: Q=100 Z=50 (FIFO)", qWithZ === 100 && zWithZ === 50, `Q=${qWithZ} Z=${zWithZ}`);
  check("(c) küme değişince projeksiyon DEĞİŞTİ", JSON.stringify(pvQ.orders) !== JSON.stringify(pvQZ.orders));

  // Çift-sayım önleme: aday kümede COMMIT'li P varsa, kendi katkısı (150) düşülür →
  // P projeksiyonu over-credit olmadan 150 (alreadyShipped 0 görülür), 100 değil 300 ihtiyaç.
  // (P qty 300, commit 150 → kısmi → aday olarak geçerli kalır; double-count gerçekten test edilir.)
  const pvP = await preview([P.id]);
  check("çift-sayım: {P} projeksiyon 150 (over-credit yok)", projOf(pvP, P.id) === 150, String(projOf(pvP, P.id)));
  const pRow = pvP.orders.find((o) => o.orderId === P.id);
  check("çift-sayım: {P} alreadyShipped 0 (kendi commit'i hariç)", pRow?.alreadyShipped === 0, String(pRow?.alreadyShipped));
  check("çift-sayım: {P} planned 300", pRow?.planned === 300, String(pRow?.planned));
  check("totals: {P} leftover 0 (150 mal − 150 tahsis)", pvP.totals.leftover === 0, JSON.stringify(pvP.totals));

  // Geçersiz aday → ignored (atma yok).
  const pvForeign = await preview([P.id, foreign.id]);
  check("ignored: yabancı müşteri siparişi ignored'da", pvForeign.ignored.some((i) => i.reason.includes("müşteri")));
  check("ignored: yabancı sipariş projeksiyona girmedi", !pvForeign.orders.some((o) => o.orderId === foreign.id));

  // editable bayrağı READY'de true.
  check("editable: READY'de true", pvP.editable === true);

  // (b) EŞDEĞERLİK (kritik): preview projeksiyonu = gerçek retarget commit sonucu.
  // Aday küme {Q,Z} için önce önizle, sonra gerçekten retarget et, artışları karşılaştır.
  const pvEquiv = await preview([Q.id, Z.id]);
  const qProjected = projOf(pvEquiv, Q.id);
  const zProjected = projOf(pvEquiv, Z.id);
  const qBeforeRt = await shippedQty(Q.lineId);
  const zBeforeRt = await shippedQty(Z.lineId);
  await ship.retargetOrders(shipment.id, [Q.id, Z.id]); // GERÇEK commit (reverse P + commit Q,Z)
  const qDelta = (await shippedQty(Q.lineId)) - qBeforeRt;
  const zDelta = (await shippedQty(Z.lineId)) - zBeforeRt;
  check("(b) EŞDEĞERLİK: Q projeksiyon = gerçek artış", qProjected === qDelta, `proj=${qProjected} gerçek=${qDelta}`);
  check("(b) EŞDEĞERLİK: Z projeksiyon = gerçek artış", zProjected === zDelta, `proj=${zProjected} gerçek=${zDelta}`);
  // Gerçek allocation kayıtlarıyla da birebir.
  const allocs = await prisma.shipmentAllocation.findMany({ where: { shipmentId: shipment.id }, select: { orderLineId: true, qty: true } });
  const realQ = Number(allocs.find((a) => a.orderLineId === Q.lineId)?.qty ?? 0);
  const realZ = Number(allocs.find((a) => a.orderLineId === Z.lineId)?.qty ?? 0);
  check("(b) EŞDEĞERLİK: Q projeksiyon = ShipmentAllocation.qty", qProjected === realQ, `proj=${qProjected} alloc=${realQ}`);
  check("(b) EŞDEĞERLİK: Z projeksiyon = ShipmentAllocation.qty", zProjected === realZ, `proj=${zProjected} alloc=${realZ}`);

  // Cleanup (kendi fixture'ı).
  await prisma.shipmentAllocation.deleteMany({ where: { shipmentId: shipment.id } });
  await prisma.roll.deleteMany({ where: { id: roll.id } });
  await prisma.sack.deleteMany({ where: { shipmentId: shipment.id } });
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: shipment.id } });
  await prisma.shipment.delete({ where: { id: shipment.id } }).catch(() => {});
  for (const o of [P, Q, Z, foreign]) {
    await prisma.orderLine.deleteMany({ where: { orderId: o.id } });
    await prisma.order.delete({ where: { id: o.id } }).catch(() => {});
  }
}

async function main() {
  const ts = Date.now();
  const ship = new ShippingService();

  const customer = await prisma.customer.create({ data: { code: `TST-RTG-${ts}`, name: "TEST RETARGET" }, select: { id: true } });
  const other = await prisma.customer.create({ data: { code: `TST-RTG-O-${ts}`, name: "TEST RETARGET DİĞER" }, select: { id: true } });
  const item = await prisma.item.create({ data: { code: `TST-RTG-I-${ts}`, name: "RTG ÜRÜN", itemType: "FABRIC", unit: "MT" }, select: { id: true } });

  const mkOrder = async (cust: string, n: number) => {
    const o = await prisma.order.create({
      data: {
        orderNumber: `TEST-RTG-${ts}-${n}`,
        customerId: cust,
        status: "APPROVED",
        orderDate: new Date(),
        lines: { create: [{ itemId: item.id, quantity: 100, width: 150 }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    return { id: o.id, lineId: o.lines[0].id };
  };
  const orderA = await mkOrder(customer.id, 1);
  const orderB = await mkOrder(customer.id, 2);
  const orderOther = await mkOrder(other.id, 3);

  const shipment = await prisma.shipment.create({
    data: { shipmentNo: `TEST-RTG-${ts}`, customerId: customer.id, status: "PREPARING", orders: { create: [{ orderId: orderA.id }] } },
    select: { id: true },
  });
  const r1 = await prisma.roll.create({
    data: {
      barcode: `TEST-RTG-R1-${ts}`, itemId: item.id, status: "WAREHOUSE", currentQty: 100, initialQty: 100,
      width: 150, qualityGrade: "A", entrySource: "SUPPLIER_RECEIPT", shipmentId: shipment.id,
    },
    select: { id: true, barcode: true },
  });
  const sack = (await ship.addSack({ shipmentId: shipment.id })).data as { id: string };
  await prisma.roll.update({ where: { id: r1.id }, data: { sackId: sack.id } });

  const shippedQty = async (lineId: string) =>
    Number((await prisma.orderLine.findUnique({ where: { id: lineId }, select: { shippedQty: true } }))!.shippedQty);

  try {
    // 3) farklı müşteri reddedilir
    await expectErr("Farklı müşteri siparişi 400", 400, () => ship.retargetOrders(shipment.id, [orderOther.id]));

    // 1) PREPARING replace (A → B)
    await ship.retargetOrders(shipment.id, [orderB.id]);
    const so = await prisma.shipmentOrder.findMany({ where: { shipmentId: shipment.id }, select: { orderId: true } });
    check("PREPARING retarget: sipariş kümesi B oldu", so.length === 1 && so[0].orderId === orderB.id);

    // 2) READY commit sonrası retarget B → A: B düşer, A yazılır
    await ship.updateSack({ sackId: sack.id, weightKg: 30, manualCode: `RTG${ts}` });
    await ship.markReady(shipment.id);
    check("READY commit: B shippedQty=100", (await shippedQty(orderB.lineId)) === 100);
    await ship.retargetOrders(shipment.id, [orderA.id]);
    check("READY retarget: B geri sarıldı (0)", (await shippedQty(orderB.lineId)) === 0);
    check("READY retarget: A yazıldı (100)", (await shippedQty(orderA.lineId)) === 100, String(await shippedQty(orderA.lineId)));

    // 5) ÖNİZLEME (saha #7 artımlı) — DISPATCHED'a çekmeden ÖNCE çalıştır.
    await previewSuite(ship, customer.id, item.id, other.id, ts);

    // 4) DISPATCHED reddedilir
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: "DISPATCHED" } });
    await expectErr("DISPATCHED retarget 409", 409, () => ship.retargetOrders(shipment.id, [orderB.id]));
  } finally {
    await prisma.shipmentAllocation.deleteMany({ where: { shipmentId: shipment.id } });
    await prisma.roll.deleteMany({ where: { id: r1.id } });
    await prisma.sack.deleteMany({ where: { shipmentId: shipment.id } });
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: shipment.id } });
    await prisma.shipment.delete({ where: { id: shipment.id } }).catch(() => {});
    for (const o of [orderA, orderB, orderOther]) {
      await prisma.orderLine.deleteMany({ where: { orderId: o.id } });
      await prisma.order.delete({ where: { id: o.id } }).catch(() => {});
    }
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { in: [customer.id, other.id] } } });
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

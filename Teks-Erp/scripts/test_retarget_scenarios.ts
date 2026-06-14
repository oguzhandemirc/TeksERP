// =============================================================================
// Test: Saha #7 — retarget ÖNİZLEME (previewRetargetOrders) ÇEŞİTLİ SENARYOLAR
// Çalıştır: npx tsx scripts/test_retarget_scenarios.ts
// =============================================================================
// previewRetargetOrders SALT-OKUNUR; gerçek commit'le aynı saf allocate()'i kullanır
// (eşdeğerlik test_shipment_retarget.ts'te kanıtlı). Burada tahsis MANTIĞININ çeşitli
// kenar durumlarda DOĞRU sonucu verdiğini KESİN sayılarla doğruluyoruz:
//   spec gevşek eşleşme (renk/en null), FIFO (deadline→orderDate), over/partial
//   coverage, aynı-spec bölüşüm, pool tükenme, durum (AT_DOOR/DISPATCHED/CANCELLED),
//   ignored (karma/tümü), boş aday.
// İzolasyon: preview yalnız BU sevkiyatın WAREHOUSE toplarını + verilen aday
// siparişleri görür (global tarih sorgusu yok) → her senaryo kendi sevkiyatıyla saf.
// =============================================================================
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { OrderStatus } from "@prisma/client";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

type Preview = {
  editable: boolean;
  orders: { orderId: string; orderNumber: string; planned: number; alreadyShipped: number; projected: number; coveragePct: number }[];
  totals: { goods: number; projectedTotal: number; leftover: number };
  ignored: { orderNumber: string; reason: string }[];
};

async function main() {
  const ts = Date.now();
  const ship = new ShippingService();
  let nseq = 0;
  const uid = () => `${ts}-${++nseq}`;

  // ---- Master data (read-only preview'da paylaşılır) ----
  const customer = await prisma.customer.create({ data: { code: `TST-RTGS-C-${ts}`, name: "RTGS MÜŞTERİ" }, select: { id: true } });
  const other = await prisma.customer.create({ data: { code: `TST-RTGS-O-${ts}`, name: "RTGS DİĞER" }, select: { id: true } });
  const itemX = await prisma.item.create({ data: { code: `TST-RTGS-X-${ts}`, name: "RTGS ÜRÜN X", itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const itemA = await prisma.item.create({ data: { code: `TST-RTGS-A-${ts}`, name: "RTGS ÜRÜN A", itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const colorY = await prisma.color.create({ data: { code: `TST-RTGS-CY-${ts}`, name: `RTGS-SARI-${ts}` }, select: { id: true } });
  const colorB = await prisma.color.create({ data: { code: `TST-RTGS-CB-${ts}`, name: `RTGS-MAVI-${ts}` }, select: { id: true } });

  const shipmentIds: string[] = [];
  const orderIds: string[] = [];

  // ---- Yardımcılar ----
  const mkShipment = async (status: string): Promise<string> => {
    const s = await prisma.shipment.create({
      data: { shipmentNo: `TEST-RTGS-${uid()}`, customerId: customer.id, status: status as never },
      select: { id: true },
    });
    shipmentIds.push(s.id);
    return s.id;
  };
  const addRoll = async (shipmentId: string, spec: { itemId: string; colorId?: string | null; width?: number | null; qty: number }) => {
    await prisma.roll.create({
      data: {
        barcode: `TEST-RTGS-R-${uid()}`,
        itemId: spec.itemId,
        colorId: spec.colorId ?? null,
        width: spec.width ?? null,
        status: "WAREHOUSE",
        currentQty: spec.qty,
        initialQty: spec.qty,
        qualityGrade: "A",
        entrySource: "SUPPLIER_RECEIPT",
        shipmentId,
      },
    });
  };
  const mkOrder = async (opts: {
    customerId?: string; qty: number; itemId?: string; colorId?: string | null; width?: number | null;
    deadline?: Date | null; orderDate?: Date; status?: OrderStatus;
  }): Promise<{ id: string }> => {
    const o = await prisma.order.create({
      data: {
        orderNumber: `TEST-RTGS-O-${uid()}`,
        customerId: opts.customerId ?? customer.id,
        status: opts.status ?? OrderStatus.APPROVED,
        orderDate: opts.orderDate ?? new Date("2029-01-01T00:00:00Z"),
        deadline: opts.deadline ?? null,
        lines: { create: [{ itemId: opts.itemId ?? itemX.id, colorId: opts.colorId ?? null, width: opts.width ?? null, quantity: opts.qty }] },
      },
      select: { id: true },
    });
    orderIds.push(o.id);
    return { id: o.id };
  };
  const preview = async (shipmentId: string, ids: string[]): Promise<Preview> =>
    ((await ship.previewRetargetOrders(shipmentId, ids)).data as Preview);
  const projOf = (p: Preview, id: string) => p.orders.find((o) => o.orderId === id)?.projected ?? 0;
  const rowOf = (p: Preview, id: string) => p.orders.find((o) => o.orderId === id);

  const D1 = new Date("2030-01-01T00:00:00Z");
  const D2 = new Date("2030-06-01T00:00:00Z");
  const D3 = new Date("2030-09-01T00:00:00Z");

  try {
    // S1 — renk=null top (ham), renk-Y siparişi karşılar (gevşek eşleşme)
    {
      const s = await mkShipment("PREPARING");
      await addRoll(s, { itemId: itemX.id, colorId: null, width: 150, qty: 100 });
      const q = await mkOrder({ qty: 80, itemId: itemX.id, colorId: colorY.id, width: 150 });
      const p = await preview(s, [q.id]);
      check("S1 renk=null top renk-Y siparişi karşılar (gevşek)", projOf(p, q.id) === 80 && p.totals.leftover === 20, `proj=${projOf(p, q.id)} leftover=${p.totals.leftover}`);
    }

    // S2 — renk=null sipariş, renk-B topla eşleşir (gevşek)
    {
      const s = await mkShipment("PREPARING");
      await addRoll(s, { itemId: itemX.id, colorId: colorB.id, width: 150, qty: 100 });
      const q = await mkOrder({ qty: 80, itemId: itemX.id, colorId: null, width: 150 });
      const p = await preview(s, [q.id]);
      check("S2 renk=null sipariş renk-B topla eşleşir (gevşek)", projOf(p, q.id) === 80, `proj=${projOf(p, q.id)}`);
    }

    // S3 — en=null gevşek eşleşme
    {
      const s = await mkShipment("PREPARING");
      await addRoll(s, { itemId: itemX.id, colorId: colorY.id, width: null, qty: 100 });
      const q = await mkOrder({ qty: 60, itemId: itemX.id, colorId: colorY.id, width: 150 });
      const p = await preview(s, [q.id]);
      check("S3 en=null top, en-150 siparişi karşılar (gevşek)", projOf(p, q.id) === 60 && p.totals.leftover === 40, `proj=${projOf(p, q.id)}`);
    }

    // S4 — renk+en ikisi null (maksimal gevşek)
    {
      const s = await mkShipment("PREPARING");
      await addRoll(s, { itemId: itemX.id, colorId: null, width: null, qty: 100 });
      const q = await mkOrder({ qty: 70, itemId: itemX.id, colorId: null, width: null });
      const p = await preview(s, [q.id]);
      check("S4 renk+en null (maks gevşek) eşleşir", projOf(p, q.id) === 70 && p.totals.leftover === 30, `proj=${projOf(p, q.id)}`);
    }

    // S5 — farklı item → eşleşmez (item kesin)
    {
      const s = await mkShipment("PREPARING");
      await addRoll(s, { itemId: itemX.id, colorId: colorY.id, width: 150, qty: 100 });
      const q = await mkOrder({ qty: 50, itemId: itemA.id, colorId: colorY.id, width: 150 });
      const p = await preview(s, [q.id]);
      const r = rowOf(p, q.id);
      check("S5 farklı item eşleşmez (proj 0, coverage 0, leftover 100)", projOf(p, q.id) === 0 && r?.coveragePct === 0 && p.totals.leftover === 100, `proj=${projOf(p, q.id)} cov=${r?.coveragePct}`);
    }

    // S6 — FIFO: erken deadline önce tam dolar, sonraki kısmi
    {
      const s = await mkShipment("PREPARING");
      await addRoll(s, { itemId: itemX.id, colorId: colorY.id, width: 150, qty: 60 });
      const q = await mkOrder({ qty: 50, colorId: colorY.id, width: 150, deadline: D1 });
      const r = await mkOrder({ qty: 40, colorId: colorY.id, width: 150, deadline: D2 });
      const p = await preview(s, [q.id, r.id]);
      check("S6 FIFO deadline: erken=50 tam, sonraki=10 kısmi", projOf(p, q.id) === 50 && projOf(p, r.id) === 10, `Q=${projOf(p, q.id)} R=${projOf(p, r.id)}`);
    }

    // S7 — deadline null → orderDate FIFO
    {
      const s = await mkShipment("PREPARING");
      await addRoll(s, { itemId: itemX.id, colorId: colorY.id, width: 150, qty: 60 });
      const q = await mkOrder({ qty: 50, colorId: colorY.id, width: 150, deadline: null, orderDate: new Date("2029-01-01T00:00:00Z") });
      const r = await mkOrder({ qty: 40, colorId: colorY.id, width: 150, deadline: null, orderDate: new Date("2029-06-01T00:00:00Z") });
      const p = await preview(s, [q.id, r.id]);
      check("S7 FIFO orderDate (deadline null): eski=50, yeni=10", projOf(p, q.id) === 50 && projOf(p, r.id) === 10, `Q=${projOf(p, q.id)} R=${projOf(p, r.id)}`);
    }

    // S8 — aynı spec 2 sipariş FIFO bölüşüm (pool 80: Q=50, R=30 kısmi)
    {
      const s = await mkShipment("PREPARING");
      await addRoll(s, { itemId: itemX.id, colorId: colorY.id, width: 150, qty: 80 });
      const q = await mkOrder({ qty: 50, colorId: colorY.id, width: 150, deadline: D1 });
      const r = await mkOrder({ qty: 40, colorId: colorY.id, width: 150, deadline: D2 });
      const p = await preview(s, [q.id, r.id]);
      check("S8 aynı-spec FIFO bölüşüm: Q=50, R=30 (kısmi), leftover=0", projOf(p, q.id) === 50 && projOf(p, r.id) === 30 && p.totals.leftover === 0, `Q=${projOf(p, q.id)} R=${projOf(p, r.id)}`);
    }

    // S9 — pool tükenince kuyruk sonu sipariş = 0
    {
      const s = await mkShipment("PREPARING");
      await addRoll(s, { itemId: itemX.id, colorId: colorY.id, width: 150, qty: 80 });
      const q = await mkOrder({ qty: 40, colorId: colorY.id, width: 150, deadline: D1 });
      const r = await mkOrder({ qty: 40, colorId: colorY.id, width: 150, deadline: D2 });
      const u = await mkOrder({ qty: 40, colorId: colorY.id, width: 150, deadline: D3 });
      const p = await preview(s, [q.id, r.id, u.id]);
      check("S9 pool tükendi: Q=40 R=40 S=0", projOf(p, q.id) === 40 && projOf(p, r.id) === 40 && projOf(p, u.id) === 0, `Q=${projOf(p, q.id)} R=${projOf(p, r.id)} S=${projOf(p, u.id)}`);
    }

    // S10 — over-supply çok-spec leftover (X,Y=100 + A,B=50; Q istek 30 + R istek 40)
    {
      const s = await mkShipment("PREPARING");
      await addRoll(s, { itemId: itemX.id, colorId: colorY.id, width: 150, qty: 100 });
      await addRoll(s, { itemId: itemA.id, colorId: colorB.id, width: 150, qty: 50 });
      const q = await mkOrder({ qty: 30, itemId: itemX.id, colorId: colorY.id, width: 150 });
      const r = await mkOrder({ qty: 40, itemId: itemA.id, colorId: colorB.id, width: 150 });
      const p = await preview(s, [q.id, r.id]);
      check("S10 over-supply çok-spec: Q=30 R=40, goods=150 proj=70 leftover=80",
        projOf(p, q.id) === 30 && projOf(p, r.id) === 40 && p.totals.goods === 150 && p.totals.projectedTotal === 70 && p.totals.leftover === 80,
        JSON.stringify(p.totals));
    }

    // S11 — partial coverage (60m mal, 100m istek → coveragePct 60)
    {
      const s = await mkShipment("PREPARING");
      await addRoll(s, { itemId: itemX.id, colorId: colorY.id, width: 150, qty: 60 });
      const q = await mkOrder({ qty: 100, colorId: colorY.id, width: 150 });
      const p = await preview(s, [q.id]);
      const r = rowOf(p, q.id);
      check("S11 partial coverage: proj=60 coveragePct=60 leftover=0", projOf(p, q.id) === 60 && r?.coveragePct === 60 && p.totals.leftover === 0, `proj=${projOf(p, q.id)} cov=${r?.coveragePct}`);
    }

    // S12 — AT_DOOR'da preview: editable=true, projeksiyon doğru
    {
      const s = await mkShipment("AT_DOOR");
      await addRoll(s, { itemId: itemX.id, colorId: colorY.id, width: 150, qty: 100 });
      const q = await mkOrder({ qty: 80, colorId: colorY.id, width: 150 });
      const p = await preview(s, [q.id]);
      check("S12 AT_DOOR: editable=true + proj=80", p.editable === true && projOf(p, q.id) === 80, `editable=${p.editable} proj=${projOf(p, q.id)}`);
    }

    // S13 — DISPATCHED'da preview: editable=false, hata yok, projeksiyon yine hesaplanır
    {
      const s = await mkShipment("DISPATCHED");
      await addRoll(s, { itemId: itemX.id, colorId: colorY.id, width: 150, qty: 100 });
      const q = await mkOrder({ qty: 80, colorId: colorY.id, width: 150 });
      const p = await preview(s, [q.id]);
      check("S13 DISPATCHED: editable=false (hata yok, proj hesaplandı)", p.editable === false && projOf(p, q.id) === 80, `editable=${p.editable} proj=${projOf(p, q.id)}`);
    }

    // S14 — CANCELLED'da preview: editable=false, hata yok
    {
      const s = await mkShipment("CANCELLED");
      await addRoll(s, { itemId: itemX.id, colorId: colorY.id, width: 150, qty: 100 });
      const q = await mkOrder({ qty: 80, colorId: colorY.id, width: 150 });
      const p = await preview(s, [q.id]);
      check("S14 CANCELLED: editable=false (hata yok)", p.editable === false, `editable=${p.editable}`);
    }

    // S15 — karma ignored: geçerli + yabancı müşteri + kapalı sipariş
    {
      const s = await mkShipment("PREPARING");
      await addRoll(s, { itemId: itemX.id, colorId: colorY.id, width: 150, qty: 100 });
      const valid = await mkOrder({ qty: 50, colorId: colorY.id, width: 150 });
      const foreign = await mkOrder({ customerId: other.id, qty: 50, colorId: colorY.id, width: 150 });
      const closed = await mkOrder({ qty: 50, colorId: colorY.id, width: 150, status: OrderStatus.COMPLETED });
      const p = await preview(s, [valid.id, foreign.id, closed.id]);
      check("S15 karma ignored: geçerli proj=50", projOf(p, valid.id) === 50, `proj=${projOf(p, valid.id)}`);
      check("S15 karma ignored: 2 ignored (yabancı+kapalı)", p.ignored.length === 2 && p.orders.length === 1, `ignored=${p.ignored.length} orders=${p.orders.length}`);
      check("S15 ignored sebepleri (müşteri + kapalı)",
        p.ignored.some((i) => i.reason.includes("müşteri")) && p.ignored.some((i) => i.reason.toLowerCase().includes("kapalı")),
        JSON.stringify(p.ignored.map((i) => i.reason)));
    }

    // S16 — tümü ignored: orders boş, leftover=goods
    {
      const s = await mkShipment("PREPARING");
      await addRoll(s, { itemId: itemX.id, colorId: colorY.id, width: 150, qty: 100 });
      const foreign = await mkOrder({ customerId: other.id, qty: 50, colorId: colorY.id, width: 150 });
      const closed = await mkOrder({ qty: 50, colorId: colorY.id, width: 150, status: OrderStatus.CANCELLED });
      const p = await preview(s, [foreign.id, closed.id]);
      check("S16 tümü ignored: orders=[] ignored=2 leftover=100", p.orders.length === 0 && p.ignored.length === 2 && p.totals.leftover === 100, `orders=${p.orders.length} ignored=${p.ignored.length} leftover=${p.totals.leftover}`);
    }

    // S17 — boş aday küme: orders=[] ignored=[] leftover=goods, editable=true
    {
      const s = await mkShipment("PREPARING");
      await addRoll(s, { itemId: itemX.id, colorId: colorY.id, width: 150, qty: 100 });
      const p = await preview(s, []);
      check("S17 boş aday: orders=[] ignored=[] leftover=100 editable=true",
        p.orders.length === 0 && p.ignored.length === 0 && p.totals.leftover === 100 && p.editable === true,
        JSON.stringify(p.totals));
    }
  } finally {
    await prisma.shipmentAllocation.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.roll.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.sack.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.item.deleteMany({ where: { id: { in: [itemX.id, itemA.id] } } });
    await prisma.color.deleteMany({ where: { id: { in: [colorY.id, colorB.id] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [customer.id, other.id] } } });
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

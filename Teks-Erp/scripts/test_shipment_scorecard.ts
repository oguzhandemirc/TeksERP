// =============================================================================
// Test: SEVK & TERMİN KARNESİ (OTIF)
// Çalıştır: npx tsx scripts/test_shipment_scorecard.ts
// =============================================================================
// İKİ KRİTİK KURAL:
//   1. TERMİNİ OLMAYAN SİPARİŞ ORANA GİRMEZ. `deadline` nullable; onları
//      "zamanında" saymak oranı sahte yükseltir, "geç" saymak haksız düşürür.
//      Doğru olan paydadan çıkarmak VE sayıyı ayrıca göstermektir.
//   2. SEVK HACMİ TEK TANIMDAN gelir (`_shipped.ts`) — İade Karnesi'nin
//      paydasıyla aynı fonksiyon. Bu test iki servisi de çağırıp eşitliği ölçer;
//      ayrışırlarsa aynı ay için iki farklı sevk rakamı dolaşıma girer.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { getShipmentScorecard } from "../src/services/reports/shipment-scorecard.report.service";
import { getReturnScorecard } from "../src/services/reports/return-scorecard.report.service";
import { resolveCompareRange, type DateRange } from "../src/services/reports/_shared";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const TAG = `TEST-OTIF-${Date.now()}`;
const RANGE: DateRange = {
  from: new Date("2095-06-01T00:00:00.000Z"),
  to: new Date("2095-06-30T23:59:59.999Z"),
};
const IN_WINDOW = new Date("2095-06-15T10:00:00.000Z");
const IN_PREV = new Date("2095-05-15T10:00:00.000Z");

const ids = { rolls: [] as string[], shipments: [] as string[], orders: [] as string[], lines: [] as string[] };

async function main(): Promise<void> {
  console.log("\n=== Sevk & Termin Karnesi bekçisi ===\n");

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const customer = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item || !customer) { console.log("❌ Ön koşul yok"); fail++; return; }

  // ── SEVK ──────────────────────────────────────────────────────────────────
  const ship = await prisma.shipment.create({
    data: { shipmentNo: `${TAG}-S1`, customerId: customer.id, status: "DISPATCHED", dispatchedAt: IN_WINDOW },
    select: { id: true },
  });
  ids.shipments.push(ship.id);
  const mkRoll = async (qty: number, shipmentId: string | null) => {
    const r = await prisma.roll.create({
      data: {
        itemId: item.id, initialQty: qty, currentQty: qty, status: "SHIPPED",
        entrySource: "SUPPLIER_RECEIPT", shipmentId, barcode: `${TAG}-R${ids.rolls.length}`,
      },
      select: { id: true },
    });
    ids.rolls.push(r.id);
    return r.id;
  };
  await mkRoll(800, ship.id);
  await mkRoll(200, ship.id);
  // PLANNED sevkiyat — henüz çıkmadı, sayılmamalı
  const planned = await prisma.shipment.create({
    data: { shipmentNo: `${TAG}-S2`, customerId: customer.id, status: "PLANNED" },
    select: { id: true },
  });
  ids.shipments.push(planned.id);
  await mkRoll(999, planned.id);
  // Önceki dönem: 400 m
  const prevShip = await prisma.shipment.create({
    data: { shipmentNo: `${TAG}-S0`, customerId: customer.id, status: "DISPATCHED", dispatchedAt: IN_PREV },
    select: { id: true },
  });
  ids.shipments.push(prevShip.id);
  await mkRoll(400, prevShip.id);

  // ── TERMİN ────────────────────────────────────────────────────────────────
  const mkOrder = async (o: { deadline: Date | null; completedAt: Date; status?: "COMPLETED" | "CANCELLED" }) => {
    const ord = await prisma.order.create({
      data: {
        orderNumber: `${TAG}-O${ids.orders.length}`, customerId: customer.id,
        status: o.status ?? "COMPLETED", deadline: o.deadline, completedAt: o.completedAt,
      },
      select: { id: true },
    });
    ids.orders.push(ord.id);
    return ord.id;
  };
  const D = (s: string) => new Date(s);
  await mkOrder({ deadline: D("2095-06-20T00:00:00Z"), completedAt: D("2095-06-18T00:00:00Z") }); // zamanında
  await mkOrder({ deadline: D("2095-06-20T00:00:00Z"), completedAt: D("2095-06-19T00:00:00Z") }); // zamanında
  await mkOrder({ deadline: D("2095-06-10T00:00:00Z"), completedAt: D("2095-06-14T00:00:00Z") }); // 4 gün geç
  // TERMİNSİZ — orana GİRMEMELİ (2 zamanında + 1 geç = %66,7; bu sayılsaydı %75)
  await mkOrder({ deadline: null, completedAt: IN_WINDOW });
  // İPTAL — hiç sayılmamalı
  await mkOrder({ deadline: D("2095-06-01T00:00:00Z"), completedAt: IN_WINDOW, status: "CANCELLED" });
  // Önceki dönem: 1 zamanında / 1 geç = %50
  await mkOrder({ deadline: D("2095-05-20T00:00:00Z"), completedAt: D("2095-05-18T00:00:00Z") });
  await mkOrder({ deadline: D("2095-05-10T00:00:00Z"), completedAt: D("2095-05-16T00:00:00Z") });

  const compareRange = resolveCompareRange({ compare: "prev" }, RANGE);
  const sc = await getShipmentScorecard(RANGE, compareRange);

  // ── 1) SEVK HACMİ ─────────────────────────────────────────────────────────
  console.log("── 1) Sevk hacmi ──");
  check("sevk metrajı 1000 m", sc.summary.shippedQty === 1000, `gelen: ${sc.summary.shippedQty}`);
  check("PLANNED sevkiyat sayılmaz", sc.summary.shippedQty === 1000, "999 m sayılsaydı 1999 olurdu");
  check("kırılım toplamı = özet",
    Math.round(sc.byCustomer.reduce((a, r) => a + r.qty, 0) * 10) / 10 === 1000,
    `${sc.byCustomer.reduce((a, r) => a + r.qty, 0)}`);

  // ── 2) TEK TANIM (İade Karnesi ile mutabakat) ─────────────────────────────
  console.log("\n── 2) Sevk metrajı İade Karnesi'nin paydasıyla BİREBİR ──");
  const ret = await getReturnScorecard(RANGE, null);
  check(
    "iki karne aynı sevk rakamını söyler",
    sc.summary.shippedQty === ret.summary.shippedQty,
    `${sc.summary.shippedQty} ↔ ${ret.summary.shippedQty}`,
  );

  // ── 3) TERMİNSİZ SİPARİŞ ORANA GİRMEZ ─────────────────────────────────────
  console.log("\n── 3) Terminsiz sipariş orana girmez ama gizlenmez ──");
  check("kapanan sipariş 4 (iptal hariç)", sc.summary.completedOrders === 4, `gelen: ${sc.summary.completedOrders}`);
  check("terminli sipariş 3", sc.summary.withDeadlineOrders === 3, `gelen: ${sc.summary.withDeadlineOrders}`);
  check("terminsiz sipariş 1 — SAYILIP gösteriliyor", sc.summary.noDeadlineOrders === 1,
    `gelen: ${sc.summary.noDeadlineOrders}`);
  check(
    "zamanında oranı %66,7 (2/3) — terminsiz paydaya girseydi %50 çıkardı",
    sc.summary.onTimePct === 66.7,
    `gelen: ${sc.summary.onTimePct}`,
  );
  check("iptal edilmiş sipariş hiç sayılmadı", sc.summary.completedOrders === 4, "sayılsaydı 5 olurdu");
  check("ortalama gecikme 4 gün", sc.summary.avgLateDays === 4, `gelen: ${sc.summary.avgLateDays}`);

  // ── 4) KARŞILAŞTIRMA ──────────────────────────────────────────────────────
  console.log("\n── 4) Dönem karşılaştırma ──");
  check("önceki dönem sevk 400 m", sc.summary.prevShippedQty === 400, `gelen: ${sc.summary.prevShippedQty}`);
  check("önceki dönem zamanında %50", sc.summary.prevOnTimePct === 50, `gelen: ${sc.summary.prevOnTimePct}`);
  check("kırılımda önceki dönem taşınıyor", sc.byCustomer[0]?.prevQty === 400, `gelen: ${sc.byCustomer[0]?.prevQty}`);
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    if (ids.lines.length) await prisma.orderLine.deleteMany({ where: { id: { in: ids.lines } } });
    if (ids.orders.length) await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
    if (ids.rolls.length) await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    if (ids.shipments.length) await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });

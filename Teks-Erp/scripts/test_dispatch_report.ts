// =============================================================================
// Test: Saha #2 — muhasebe sevk fişi (ürün/çuval/çeki listesi)
// Çalıştır: npx tsx scripts/test_dispatch_report.ts
// Kurulum: sevkiyat + 2 çuval; Çuval-1: 2 top (ürün A, renkli, 150cm),
//          Çuval-2: 1 top (ürün A) + 1 top (ürün B). Tartılar girilir.
// Doğrulananlar:
//   1. ÜRÜN LİSTESİ ürün+renk+en bazında gruplanır (adet + metre)
//   2. ÇUVAL LİSTESİ metre/kg/paket sayısı doğru
//   3. ÇEKİ LİSTESİ kg yalnız çuvalın İLK topunda, diğerleri 0
//   4. totals (top/metre/kg/çuval) tutarlı
//   5. header: müşteri/sevkNo/procedureCode/destination
// =============================================================================
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

async function main() {
  const ts = Date.now();
  const svc = new ShippingService();

  const customer = await prisma.customer.create({
    data: { code: `TST-RPT-${ts}`, name: "TEST RAPOR MÜŞTERİ" },
    select: { id: true },
  });
  const itemA = await prisma.item.create({
    data: { code: `TST-RPT-A-${ts}`, name: "MC 156", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const itemB = await prisma.item.create({
    data: { code: `TST-RPT-B-${ts}`, name: "NEPS VUAL", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const colorBG = await prisma.color.create({
    data: { code: `TST-RPT-C-${ts}`, name: "BEYAZ-GÜMÜŞ" },
    select: { id: true },
  });
  const shipment = await prisma.shipment.create({
    data: {
      shipmentNo: `TEST-RPT-${ts}`,
      customerId: customer.id,
      status: "DISPATCHED",
      destination: "EXPORT",
      procedureCode: "GB-2026-123",
      dispatchedAt: new Date(),
    },
    select: { id: true },
  });
  // Rapor çuval "code"u artık sackNo (manualCode kalktı) — assertion buna göre.
  const mc1 = `TEST-RPT-SK1-${ts}`;
  const mc2 = `TEST-RPT-SK2-${ts}`;
  const sack1 = await prisma.sack.create({
    data: { sackNo: mc1, customerId: customer.id, shipmentId: shipment.id, seq: 1, weightKg: 65.8 },
    select: { id: true },
  });
  const sack2 = await prisma.sack.create({
    data: { sackNo: mc2, customerId: customer.id, shipmentId: shipment.id, seq: 2, weightKg: 40 },
    select: { id: true },
  });
  const mkRoll = (n: number, itemId: string, colorId: string | null, sackId: string, qty: number, w: number | null) =>
    prisma.roll.create({
      data: {
        barcode: `TEST-RPT-R${n}-${ts}`,
        itemId,
        colorId,
        status: "SHIPPED",
        currentQty: qty,
        initialQty: qty,
        width: w,
        qualityGrade: "A",
        entrySource: "SUPPLIER_RECEIPT",
        shipmentId: shipment.id,
        sackId,
      },
      select: { id: true, barcode: true },
    });

  const r1 = await mkRoll(1, itemA.id, colorBG.id, sack1.id, 35, 150);
  const r2 = await mkRoll(2, itemA.id, colorBG.id, sack1.id, 35, 150);
  const r3 = await mkRoll(3, itemA.id, colorBG.id, sack2.id, 35, 150);
  const r4 = await mkRoll(4, itemB.id, null, sack2.id, 40, null);

  try {
    const res = await svc.getDispatchReport(shipment.id);
    const d = res.data as {
      header: { customerName: string; shipmentNo: string; procedureCode: string | null; destination: string };
      products: Array<{ name: string; rollCount: number; totalMeters: number }>;
      sacks: Array<{ code: string; totalMeters: number; totalKg: number; packageCount: number }>;
      cekiRows: Array<{ sackCode: string; barcode: string | null; desen: string; varyant: string; meters: number; kg: number }>;
      totals: { totalRolls: number; totalMeters: number; totalKg: number; sackCount: number };
    };

    // 1) ÜRÜN LİSTESİ: "MC 156 BEYAZ-GÜMÜŞ 150cm." (3 top, 105m) + "NEPS VUAL 40cm."? hayır renksiz/ensiz
    const mcGroup = d.products.find((p) => p.name.includes("MC 156"));
    check("ÜRÜN: MC 156 grubu 3 top / 105m", mcGroup?.rollCount === 3 && mcGroup?.totalMeters === 105, `${mcGroup?.rollCount}/${mcGroup?.totalMeters}`);
    check("ÜRÜN: stok adı birleşik (ürün+renk+en)", mcGroup?.name === "MC 156 BEYAZ-GÜMÜŞ 150cm.", mcGroup?.name);
    const nepsGroup = d.products.find((p) => p.name.includes("NEPS"));
    check("ÜRÜN: NEPS VUAL grubu 1 top / 40m", nepsGroup?.rollCount === 1 && nepsGroup?.totalMeters === 40);

    // 2) ÇUVAL LİSTESİ
    const s1 = d.sacks.find((s) => s.code === mc1);
    const s2 = d.sacks.find((s) => s.code === mc2);
    check("ÇUVAL AMB00001: 70m / 65,8kg / 2 paket", s1?.totalMeters === 70 && s1?.totalKg === 65.8 && s1?.packageCount === 2);
    check("ÇUVAL AMB00002: 75m / 40kg / 2 paket", s2?.totalMeters === 75 && s2?.totalKg === 40 && s2?.packageCount === 2);

    // 3) ÇEKİ LİSTESİ: kg yalnız çuvalın ilk topunda
    const ceki1 = d.cekiRows.filter((c) => c.sackCode === mc1);
    check("ÇEKİ AMB00001 2 satır", ceki1.length === 2);
    check("ÇEKİ ilk top kg=65,8, ikinci=0", ceki1[0]?.kg === 65.8 && ceki1[1]?.kg === 0);
    check("ÇEKİ desen=ürün, varyant=renk", ceki1[0]?.desen === "MC 156" && ceki1[0]?.varyant === "BEYAZ-GÜMÜŞ");
    const ceki2 = d.cekiRows.filter((c) => c.sackCode === mc2);
    check("ÇEKİ AMB00002 ilk top kg=40, renksiz varyant boş", ceki2[0]?.kg === 40 && ceki2[1]?.kg === 0 && ceki2[1]?.varyant === "");

    // 4) totals
    check(
      "TOPLAM: 4 top / 145m / 105,8kg / 2 çuval",
      d.totals.totalRolls === 4 && d.totals.totalMeters === 145 && Math.abs(d.totals.totalKg - 105.8) < 0.001 && d.totals.sackCount === 2,
      `${d.totals.totalRolls}/${d.totals.totalMeters}/${d.totals.totalKg}/${d.totals.sackCount}`,
    );

    // 5) header
    check(
      "HEADER: müşteri/sevkNo/procedureCode/destination",
      d.header.customerName === "TEST RAPOR MÜŞTERİ" &&
        d.header.shipmentNo === `TEST-RPT-${ts}` &&
        d.header.procedureCode === "GB-2026-123" &&
        d.header.destination === "EXPORT",
    );
  } finally {
    await prisma.roll.deleteMany({ where: { id: { in: [r1.id, r2.id, r3.id, r4.id] } } });
    await prisma.sack.deleteMany({ where: { shipmentId: shipment.id } });
    await prisma.shipment.delete({ where: { id: shipment.id } }).catch(() => {});
    await prisma.color.delete({ where: { id: colorBG.id } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: { in: [itemA.id, itemB.id] } } });
    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {});
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

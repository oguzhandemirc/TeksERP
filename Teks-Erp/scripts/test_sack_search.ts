// =============================================================================
// Test: Saha #1+#23 — Çuval/Top Arama servisi
// Çalıştır: npx tsx scripts/test_sack_search.ts
// Kurulum: 1 müşteri, 1 sevkiyat (PREPARING), 2 çuval; Çuval-1'de 2 top (A ürünü)
//          + 1 top (B ürünü), Çuval-2'de 1 top (B ürünü). 1 top çuvalsız depoda.
// Doğrulananlar:
//   1. İçerik filtresi (itemId) → yalnız o ürünü içeren çuvallar + eşleşen adet/metre
//   2. sackCode araması manualCode'a vurur
//   3. müşteri + sevkiyatNo filtreleri
//   4. includeDispatched=false default → DISPATCHED görünmez
//   5. getSackContents çuval dökümü döner
//   6. locateRoll: çuvaldaki top → çuval+sevkiyat; çuvalsız top → sack null
//   7. locateRoll bilinmeyen barkod → 404
// =============================================================================
import prisma from "../src/lib/prisma";
import { SackSearchService } from "../src/services/sack-search.service";

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
  const svc = new SackSearchService();

  const customer = await prisma.customer.create({
    data: { code: `TST-SRC-${ts}`, name: "TEST ARAMA MÜŞTERİSİ" },
    select: { id: true },
  });
  const itemA = await prisma.item.create({
    data: { code: `TST-SRC-A-${ts}`, name: "TEST ARAMA ÜRÜN A", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const itemB = await prisma.item.create({
    data: { code: `TST-SRC-B-${ts}`, name: "TEST ARAMA ÜRÜN B", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const shipment = await prisma.shipment.create({
    data: { shipmentNo: `TEST-SRC-${ts}`, customerId: customer.id, status: "PREPARING" },
    select: { id: true },
  });
  const sack1 = await prisma.sack.create({
    data: { sackNo: `TEST-SRC-SK1-${ts}`, shipmentId: shipment.id, seq: 1, manualCode: `TSTAMB${ts}` },
    select: { id: true },
  });
  const sack2 = await prisma.sack.create({
    data: { sackNo: `TEST-SRC-SK2-${ts}`, shipmentId: shipment.id, seq: 2, manualCode: `TSTAMB${ts + 1}` },
    select: { id: true },
  });

  const mkRoll = (n: number, itemId: string, sackId: string | null, qty: number) =>
    prisma.roll.create({
      data: {
        barcode: `TEST-SRC-R${n}-${ts}`,
        itemId,
        status: "WAREHOUSE",
        currentQty: qty,
        initialQty: qty,
        width: 150,
        qualityGrade: "A",
        entrySource: "SUPPLIER_RECEIPT",
        shipmentId: sackId ? shipment.id : null,
        sackId,
      },
      select: { id: true, barcode: true },
    });

  const r1 = await mkRoll(1, itemA.id, sack1.id, 100);
  const r2 = await mkRoll(2, itemA.id, sack1.id, 50);
  const r3 = await mkRoll(3, itemB.id, sack1.id, 30);
  const r4 = await mkRoll(4, itemB.id, sack2.id, 70);
  const r5 = await mkRoll(5, itemA.id, null, 40); // çuvalsız serbest depo

  try {
    // 1) İçerik filtresi: itemA → yalnız sack1 (eşleşen 2 top / 150m)
    const byItem = await svc.searchSacks({ itemId: itemA.id, customerId: customer.id });
    const rows = byItem.data as Array<{
      id: string; matchRollCount: number | null; matchQty: number | null; rollCount: number; totalQty: number;
    }>;
    check("itemA filtresi yalnız Çuval-1'i döndürdü", rows.length === 1 && rows[0].id === sack1.id);
    check(
      "Eşleşen adet/metre doğru (2 top / 150m; toplam 3 top / 180m)",
      rows[0]?.matchRollCount === 2 && rows[0]?.matchQty === 150 && rows[0]?.rollCount === 3 && rows[0]?.totalQty === 180,
      `match=${rows[0]?.matchRollCount}/${rows[0]?.matchQty} all=${rows[0]?.rollCount}/${rows[0]?.totalQty}`,
    );

    // 2) sackCode → manualCode vuruşu
    const byCode = await svc.searchSacks({ sackCode: `TSTAMB${ts + 1}` });
    const codeRows = byCode.data as Array<{ id: string; matchRollCount: number | null }>;
    check("sackCode araması Çuval-2'yi buldu", codeRows.length === 1 && codeRows[0].id === sack2.id);
    check("İçerik filtresi yokken match alanları null", codeRows[0]?.matchRollCount === null);

    // 3) müşteri + sevkiyat no
    const byShip = await svc.searchSacks({ customerId: customer.id, shipmentNo: `TEST-SRC-${ts}` });
    check("Müşteri+sevkiyatNo iki çuvalı da döndürdü", (byShip.data as unknown[]).length === 2);

    // 4) DISPATCHED default dışarıda
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: "DISPATCHED" } });
    const afterDispatch = await svc.searchSacks({ customerId: customer.id });
    check("DISPATCHED default görünmez", (afterDispatch.data as unknown[]).length === 0);
    const withDispatched = await svc.searchSacks({ customerId: customer.id, includeDispatched: true });
    check("includeDispatched=true ile görünür", (withDispatched.data as unknown[]).length === 2);
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: "PREPARING" } });

    // 5) Çuval dökümü
    const contents = await svc.getSackContents(sack1.id);
    const c = contents.data as { rolls: unknown[]; shipment: { shipmentNo: string } };
    check("getSackContents 3 topu döndürdü", c.rolls.length === 3, `rolls=${c.rolls.length}`);
    check("Dökümde sevkiyat başlığı var", c.shipment.shipmentNo === `TEST-SRC-${ts}`);

    // 6) locateRoll
    const loc = await svc.locateRoll(r4.barcode);
    const lr = loc.data as { sack: { id: string } | null; shipment: { id: string } | null };
    check("locateRoll çuvaldaki topu buldu (çuval+sevkiyat)", lr.sack?.id === sack2.id && lr.shipment?.id === shipment.id);
    const locFree = await svc.locateRoll(r5.barcode);
    const lf = locFree.data as { sack: unknown; shipment: unknown; status: string };
    check("locateRoll çuvalsız top → sack/shipment null + statü", lf.sack === null && lf.shipment === null && lf.status === "WAREHOUSE");

    // 7) Bilinmeyen barkod 404
    let notFound = false;
    try {
      await svc.locateRoll(`YOK-${ts}`);
    } catch (e) {
      notFound = (e as { statusCode?: number }).statusCode === 404;
    }
    check("Bilinmeyen barkod 404", notFound);
  } finally {
    await prisma.roll.deleteMany({ where: { id: { in: [r1.id, r2.id, r3.id, r4.id, r5.id] } } });
    await prisma.sack.deleteMany({ where: { shipmentId: shipment.id } });
    await prisma.shipment.delete({ where: { id: shipment.id } }).catch(() => {});
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

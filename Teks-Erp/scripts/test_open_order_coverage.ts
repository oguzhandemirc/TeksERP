// =============================================================================
// TeksERP - Açık Sipariş Karşılanma raporu bekçisi
// =============================================================================
// EN KRİTİK İDDİA: fungible depo havuzu SATIRLARA BÖLÜNÜR, KOPYALANMAZ.
//
// Neden bu testin merkezi orası: raporun reddettiği alternatif
// (`order.service.getCoverageForLines`) havuzu her satıra TAM yazıyor. Aynı
// spec'ten üç sipariş varsa 500 m'lik stok üçüne birden sayılır ve rapor
// "hepsi karşılanıyor" der — fabrika üçünü de sevk edeceğini sanıp ikisini
// sevk edemez. Hata sessizdir: hiçbir yerde uyarı çıkmaz, yalnız rakam yalan
// söyler. Bu yüzden aynı spec'ten İKİ sipariş kuruluyor ve havuzun toplamda
// bir kez dağıtıldığı ölçülüyor.
//
// İKİNCİ İDDİA: dağıtım ACİLİYET sırasına göre — termini yakın olan havuzu
// önce alır, terminsiz olan EN SONA düşer.
// =============================================================================

import prisma from "../src/lib/prisma";
import { getOpenOrderCoverage } from "../src/services/reports/open-order-coverage.report.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const DAY = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const ts = Date.now();
  const TAG = `TEST-COV-${ts}`;

  try {
    const customer = await prisma.customer.create({
      data: { code: `${TAG}-C`, name: `${TAG} MUSTERI` },
      select: { id: true },
    });
    const item = await prisma.item.create({
      data: { code: `${TAG}-I`, name: `${TAG} KUMAS`, itemType: "FABRIC" },
      select: { id: true },
    });
    const color = await prisma.color.create({
      data: { code: `${TAG}-K`, name: `${TAG} RENK` },
      select: { id: true },
    });
    const WIDTH = 180;

    // AYNI SPEC'ten üç sipariş — havuz üçüne birden yazılmamalı.
    //   acil   : termin 2 gün sonra  → havuzu ÖNCE alır
    //   normal : termin 20 gün sonra → kalanı alır
    //   terminsiz: söz verilmemiş     → EN SONA
    const mkOrder = async (no: string, qty: number, deadline: Date | null) =>
      prisma.order.create({
        data: {
          orderNumber: `${TAG}-${no}`,
          customerId: customer.id,
          status: "APPROVED",
          ...(deadline ? { deadline } : {}),
          lines: { create: [{ itemId: item.id, colorId: color.id, width: WIDTH, quantity: qty }] },
        },
        select: { id: true },
      });
    await mkOrder("ACIL", 100, new Date(Date.now() + 2 * DAY));
    await mkOrder("NORMAL", 100, new Date(Date.now() + 20 * DAY));
    await mkOrder("TERMINSIZ", 100, null);

    // Depoda YALNIZ 120 m var — üç siparişin toplam talebi 300 m.
    await prisma.roll.create({
      data: {
        barcode: `${TAG}-R1`,
        itemId: item.id,
        colorId: color.id,
        width: WIDTH,
        initialQty: 120,
        currentQty: 120,
        status: "WAREHOUSE",
      },
    });

    const rep = await getOpenOrderCoverage();
    const mine = rep.lines.filter((l) => l.orderNumber.startsWith(TAG));
    const acil = mine.find((l) => l.orderNumber.endsWith("-ACIL"));
    const normal = mine.find((l) => l.orderNumber.endsWith("-NORMAL"));
    const terminsiz = mine.find((l) => l.orderNumber.endsWith("-TERMINSIZ"));

    console.log("\n── 1) Havuz bölünüyor mu (çift sayım YOK) ──");
    check("üç kalem de raporda", mine.length === 3, `${mine.length}`);
    const dagitilan =
      (acil?.fromWarehouseQty ?? 0) +
      (normal?.fromWarehouseQty ?? 0) +
      (terminsiz?.fromWarehouseQty ?? 0);
    check(
      "depodan dağıtılan TOPLAM = 120 (havuz bir kez)",
      dagitilan === 120,
      `dağıtılan=${dagitilan} — 360 ise havuz her satıra kopyalanmış`,
    );
    check(
      "toplam açık = 300, karşılanamayan = 180",
      mine.reduce((s, l) => s + l.openQty, 0) === 300 &&
        mine.reduce((s, l) => s + l.uncoveredQty, 0) === 180,
      JSON.stringify(mine.map((l) => [l.orderNumber.slice(-9), l.openQty, l.uncoveredQty])),
    );

    console.log("\n── 2) Aciliyet sırası ──");
    check("en acil kalem havuzu TAM alır (100)", acil?.fromWarehouseQty === 100, `${acil?.fromWarehouseQty}`);
    check("ikinci kalem KALANI alır (20)", normal?.fromWarehouseQty === 20, `${normal?.fromWarehouseQty}`);
    check("terminsiz kalem havuzdan pay ALMAZ", terminsiz?.fromWarehouseQty === 0, `${terminsiz?.fromWarehouseQty}`);

    console.log("\n── 3) Durum türetimi ──");
    check("tam karşılanan → HAZIR", acil?.state === "HAZIR", acil?.state);
    check("kısmen karşılanan → KISMI", normal?.state === "KISMI", normal?.state);
    check("hiç karşılanmayan → URETIM_GEREKLI", terminsiz?.state === "URETIM_GEREKLI", terminsiz?.state);

    console.log("\n── 4) Özet ile satırlar mutabık ──");
    const sumLines = rep.lines.reduce(
      (a, l) => ({
        open: a.open + l.openQty,
        wh: a.wh + l.fromWarehouseQty,
        prod: a.prod + l.fromProductionQty,
        unc: a.unc + l.uncoveredQty,
      }),
      { open: 0, wh: 0, prod: 0, unc: 0 },
    );
    // Tavan aşılmadıysa özet, listelenen satırların toplamı olmalı.
    if (rep.linesOmitted === 0) {
      check("özet açık metraj = Σ satır", Math.abs(sumLines.open - rep.summary.openQty) < 1, `${sumLines.open} vs ${rep.summary.openQty}`);
      check("özet depo = Σ satır", Math.abs(sumLines.wh - rep.summary.fromWarehouseQty) < 1, `${sumLines.wh} vs ${rep.summary.fromWarehouseQty}`);
      check("özet karşılanamayan = Σ satır", Math.abs(sumLines.unc - rep.summary.uncoveredQty) < 1, `${sumLines.unc} vs ${rep.summary.uncoveredQty}`);
    } else {
      check("tavan aşımı GİZLENMİYOR (linesOmitted > 0)", rep.linesOmitted > 0);
    }
    check(
      "karşılanma oranı = (depo+üretim)/açık",
      rep.summary.openQty === 0 ||
        Math.abs(
          rep.summary.coveragePct -
            ((rep.summary.fromWarehouseQty + rep.summary.fromProductionQty) * 100) /
              rep.summary.openQty,
        ) < 0.2,
      `${rep.summary.coveragePct}`,
    );

    console.log("\n── 5) Müşteri kırılımı satırlarla tutarlı ──");
    const bucket = rep.byCustomer.find((b) => b.label === `${TAG} MUSTERI`);
    check("müşteri kovası var", Boolean(bucket), rep.byCustomer.map((b) => b.label).join(","));
    check("kova açık metrajı = 300", bucket?.openQty === 300, `${bucket?.openQty}`);
    check("kova depo payı = 120", bucket?.fromWarehouseQty === 120, `${bucket?.fromWarehouseQty}`);
    check("kova kalem adedi = 3", bucket?.lineCount === 3, `${bucket?.lineCount}`);

    console.log("\n── 6) Determinizm (iki koşum aynı sırayı verir) ──");
    const rep2 = await getOpenOrderCoverage();
    check(
      "satır sırası birebir aynı",
      JSON.stringify(rep2.lines.map((l) => l.orderNumber)) ===
        JSON.stringify(rep.lines.map((l) => l.orderNumber)),
    );
  } finally {
    await prisma.roll.deleteMany({ where: { barcode: { startsWith: TAG } } });
    await prisma.order.deleteMany({ where: { orderNumber: { startsWith: TAG } } });
    await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.item.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.color.deleteMany({ where: { code: { startsWith: TAG } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

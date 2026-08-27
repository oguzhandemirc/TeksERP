// =============================================================================
// TeksERP - Talep Analizi bekçisi
// =============================================================================
// ① SPEC GRANÜLERLİĞİ: talep kumaş+renk+EN üçlüsünde sayılır. Aynı kumaşın iki
//    farklı eni AYRI spec'tir — depodaki mal ancak birebir aynı spec'i karşılar.
//    Granülerlik kumaşa düşerse rapor "çok isteniyor" der, fabrika yanlış rengi
//    ya da yanlış eni üretir; hata üretim bittikten sonra fark edilir.
// ② `customerCount` FARKLI müşteri sayar. Kalem sayısıyla aynı olsaydı, tek
//    müşterinin üç kalemi "üç müşteri istiyor" gibi okunur ve stoğa üretim
//    kararı tek müşterinin kaprisine dayandırılırdı.
// ③ AYLIK SERİ fabrika ayına göre kesilir. Ayın ilk gecesi (yerel 00:00–03:00)
//    UTC'de HÂLÂ ÖNCEKİ AYDIR; çıplak DATE_TRUNC mevsimsellik serisini kaydırır.
//
// İZOLASYON: spec/kırılım iddiaları 2019 penceresinde (fabrika verisi 2026'da
// başlıyor). Ay sınırı iddiası SQL ifadesinin kendisine karşı ölçülür — komşu
// veriden tamamen bağımsız.
// =============================================================================

import prisma from "../src/lib/prisma";
import { Prisma } from "@prisma/client";
import { getDemandAnalysis } from "../src/services/reports/demand-analysis.report.service";
import { factoryMonthSql } from "../src/constants/time";
import type { DateRange } from "../src/services/reports/_shared";

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

const RANGE: DateRange = {
  from: new Date("2019-06-01T00:00:00.000Z"),
  to: new Date("2019-06-30T23:59:59.999Z"),
};

async function main(): Promise<void> {
  const ts = Date.now();
  const TAG = `TEST-DEM-${ts}`;

  try {
    const item = await prisma.item.create({
      data: { code: `${TAG}-I`, name: `${TAG} KUMAS`, itemType: "FABRIC" },
      select: { id: true },
    });
    const kirmizi = await prisma.color.create({
      data: { code: `${TAG}-K1`, name: `${TAG} KIRMIZI` },
      select: { id: true },
    });
    const mavi = await prisma.color.create({
      data: { code: `${TAG}-K2`, name: `${TAG} MAVI` },
      select: { id: true },
    });
    const c1 = await prisma.customer.create({
      data: { code: `${TAG}-C1`, name: `${TAG} MUSTERI1` },
      select: { id: true },
    });
    const c2 = await prisma.customer.create({
      data: { code: `${TAG}-C2`, name: `${TAG} MUSTERI2` },
      select: { id: true },
    });

    let seq = 0;
    const mk = async (
      customerId: string,
      colorId: string | null,
      width: number | null,
      qty: number,
      status: "APPROVED" | "CANCELLED" = "APPROVED",
    ) =>
      prisma.order.create({
        data: {
          orderNumber: `${TAG}-${String(++seq).padStart(3, "0")}`,
          customerId,
          status,
          orderDate: new Date("2019-06-10T09:00:00.000Z"),
          lines: { create: [{ itemId: item.id, colorId, width, quantity: qty }] },
        },
        select: { id: true },
      });

    // AYNI kumaş+renk, FARKLI EN → iki AYRI spec olmalı.
    await mk(c1.id, kirmizi.id, 150, 400);
    await mk(c2.id, kirmizi.id, 180, 300);
    // Aynı kumaş+renk+EN, İKİ FARKLI müşteri → tek spec, customerCount = 2.
    await mk(c1.id, mavi.id, 150, 100);
    await mk(c2.id, mavi.id, 150, 100);
    // Renksiz talep — ayrı sayaç.
    await mk(c1.id, null, 150, 100);
    // İptal — hiçbir yere girmemeli.
    await mk(c1.id, kirmizi.id, 150, 9999, "CANCELLED");

    const r = await getDemandAnalysis(RANGE);
    const spec = (colorName: string | null, width: number | null) =>
      r.specs.find((s) => s.colorName === colorName && s.width === width);

    console.log("\n── 1) Spec granülerliği: EN ayrı spec yapar ──");
    check("toplam 4 spec (kırmızı×2 en, mavi, renksiz)", r.summary.specCount === 4, `${r.summary.specCount}`);
    const k150 = spec(`${TAG} KIRMIZI`, 150);
    const k180 = spec(`${TAG} KIRMIZI`, 180);
    check("kırmızı/150 ayrı spec (400 m)", k150?.qty === 400, `${k150?.qty}`);
    check("kırmızı/180 ayrı spec (300 m)", k180?.qty === 300, `${k180?.qty}`);
    check(
      "iki en TEK spec'te birleşmedi",
      k150 !== undefined && k180 !== undefined && k150.key !== k180.key,
      "birleşseydi 700 m'lik tek satır olurdu",
    );

    console.log("\n── 2) customerCount FARKLI müşteri sayar ──");
    const m150 = spec(`${TAG} MAVI`, 150);
    check("mavi/150 metrajı 200 (iki müşteri birleşti)", m150?.qty === 200, `${m150?.qty}`);
    check("mavi/150 kalem sayısı 2", m150?.lineCount === 2, `${m150?.lineCount}`);
    check("mavi/150 müşteri sayısı 2", m150?.customerCount === 2, `${m150?.customerCount}`);
    check("kırmızı/150 müşteri sayısı 1 (tek müşteri)", k150?.customerCount === 1, `${k150?.customerCount}`);

    console.log("\n── 3) Toplamlar ve iptal ──");
    check("toplam metraj 1000 (iptalin 9999'u yok)", r.summary.totalQty === 1000, `${r.summary.totalQty}`);
    check("kalem adedi 5", r.summary.lineCount === 5, `${r.summary.lineCount}`);
    check("renksiz talep 100 m", r.summary.colorlessQty === 100, `${r.summary.colorlessQty}`);
    check("farklı renk sayısı 2 (renksiz sayılmaz)", r.summary.colorCount === 2, `${r.summary.colorCount}`);
    check("farklı kumaş sayısı 1", r.summary.itemCount === 1, `${r.summary.itemCount}`);

    console.log("\n── 4) Çekirdek spec sayısı (%80 eşiği) ──");
    // Paylar: 400 (%40), 300 (%30), 200 (%20), 100 (%10).
    // Kümülatif: 40 → 70 → 90. Üçüncü spec'te %80 aşılır → çekirdek = 3.
    check("çekirdek spec = 3", r.summary.coreSpecCount === 3, `${r.summary.coreSpecCount}`);
    check("sıralama metraja göre DESC", r.specs[0]?.qty === 400, `${r.specs[0]?.qty}`);

    console.log("\n── 5) Kırılımlar ──");
    check(
      "kumaş kırılımı tek satır, 1000 m",
      r.byItem.length === 1 && r.byItem[0]?.qty === 1000,
      JSON.stringify(r.byItem.map((b) => [b.label, b.qty])),
    );
    const noColor = r.byColor.find((b) => b.label === "Renk belirtilmemiş");
    check("renksiz kovası ayrı ve etiketli", noColor?.qty === 100, `${noColor?.qty}`);

    console.log("\n── 6) Aylık seri FABRİKA ayına göre kesiliyor ──");
    // Ayın ilk gecesi yerel 00:30 → UTC'de bir önceki ayın son günü 21:30.
    // Fabrika ayı AĞUSTOS olmalı; çıplak (UTC) kesme TEMMUZ derdi.
    const probe = new Date("2026-07-31T21:30:00.000Z");
    const rows = await prisma.$queryRaw<Array<{ fabrika: Date; utc: Date }>>(Prisma.sql`
      SELECT ${factoryMonthSql("t.ts")} AS fabrika,
             DATE_TRUNC('month', t.ts)::date AS utc
      FROM (SELECT ${probe}::timestamptz AS ts) t
    `);
    const fabrika = rows[0]?.fabrika.toISOString().slice(0, 7);
    const utc = rows[0]?.utc.toISOString().slice(0, 7);
    check("fabrika ayı = 2026-08", fabrika === "2026-08", `${fabrika}`);
    check("çıplak UTC kesme farklı sonuç verir (2026-07)", utc === "2026-07", `${utc}`);
    check("ikisi GERÇEKTEN ayrışıyor — sonda etkili", fabrika !== utc);
  } finally {
    await prisma.order.deleteMany({ where: { orderNumber: { startsWith: TAG } } });
    await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.color.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.item.deleteMany({ where: { code: { startsWith: TAG } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

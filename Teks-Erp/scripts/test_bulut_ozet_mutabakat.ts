// =============================================================================
// Test: FABRİKA ÖZETİ MUTABAKATI — patron bulutu `ozet` projeksiyonunun kaynağı
// Çalıştır: npx tsx scripts/test_bulut_ozet_mutabakat.ts
// =============================================================================
// ⭐ İDDİA: özetin rakamları KAYNAK RAPORLA BİREBİR aynı ("ayrışan yüzey" sınıfı).
// `cloud-sync/overview.ts` mevcut rapor servislerini compose eder; biri bir gün
// "burada hızlıca hesaplayayım" derse patronun bulut ekranı ile fabrikanın rapor
// ekranı FARKLI sayı basar. Bu bekçi o kaymayı mekanik olarak yakalar (2026-08-27
// aynı sınıf: pano 48 / envanter 47). Eski `test_boss_overview`un §2'si; izin
// süzmesi ve WEB_BOSS bölümleri tünelle (B6) emekli.
// =============================================================================

import prisma, { pool } from "../src/lib/prisma";
import { getFactoryOverview } from "../src/cloud-sync/overview";
import { getStockScorecard } from "../src/services/reports/stock-scorecard.report.service";
import { getOpenOrderCoverage } from "../src/services/reports/open-order-coverage.report.service";
import { InventoryService } from "../src/services/inventory.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const RANGE = { from: new Date(Date.now() - 30 * 86400_000), to: new Date() };

// -----------------------------------------------------------------------------
// 1) RAKAM MUTABAKATI — kaynak raporla birebir
// -----------------------------------------------------------------------------
async function sectionNumbers(): Promise<void> {
  console.log("\n[1] Rakam mutabakatı (kaynak raporla birebir)");
  const o = await getFactoryOverview(RANGE);

  const stock = await getStockScorecard();
  check(
    "stok: rawQty kaynakla aynı",
    o.stock.rawQty === stock.summary.rawQty,
    `${o.stock.rawQty} ↔ ${stock.summary.rawQty}`,
  );
  check("stok: semiQty kaynakla aynı", o.stock.semiQty === stock.summary.semiQty);
  check("stok: finishedQty kaynakla aynı", o.stock.finishedQty === stock.summary.finishedQty);
  check("stok: deadQty kaynakla aynı", o.stock.deadQty === stock.summary.deadQty);

  const cov = await getOpenOrderCoverage();
  check(
    "sipariş: openQty kaynakla aynı",
    o.orders.openQty === cov.summary.openQty,
    `${o.orders.openQty} ↔ ${cov.summary.openQty}`,
  );
  check("sipariş: coveragePct kaynakla aynı", o.orders.coveragePct === cov.summary.coveragePct);
  check(
    "sipariş: geciken kalem kaynakla aynı",
    o.orders.overdueLines === cov.summary.overdueUncoveredLines,
  );

  // ⚠️ KIRILIM LİSTELERİ DE ÖLÇÜLÜR — ilk yazımda ölçülmüyordu ve negatif sonda
  // bunu yakaladı (2026-09-01): `byCustomer`da `openQty` yerine başka bir sayısal alan okumak
  // DERLENİYOR ve testi GEÇİYORDU. Yani patron ekranı sessizce başka bir rakam
  // basardı. Özet sayılar tutuyor diye kırılımın da tuttuğunu VARSAYMA.
  //
  // ⚠️ SONDA SEÇERKEN: bu veri setinde `openQty === uncoveredQty` (hiçbir sipariş
  // depodan karşılanmıyor, `fromWarehouseQty` her müşteride 0). O ikisini
  // birbiriyle değiştiren bir sonda YEŞİL kalır — kontrol yanlış olduğu için
  // değil, VERİ ayrımı ifade edemediği için. Kırmızı kanıtı `fromWarehouseQty`
  // ile ya da etiketi bozarak alınır (ikisi de ölçüldü, 2026-09-01).
  const covTop = cov.byCustomer.slice(0, 5);
  check(
    "sipariş: müşteri kırılımı kaynakla aynı (etiket VE metraj)",
    o.orders.topCustomers.length === covTop.length &&
      o.orders.topCustomers.every((r, i) => r.label === covTop[i]?.label && r.qty === covTop[i]?.openQty),
    `${o.orders.topCustomers[0]?.qty} ↔ ${covTop[0]?.openQty}`,
  );
  const stockTop = stock.byItem.slice(0, 5);
  check(
    "stok: kumaş kırılımı kaynakla aynı (etiket VE metraj)",
    o.stock.topItems.length === stockTop.length &&
      o.stock.topItems.every((r, i) => r.label === stockTop[i]?.label && r.qty === stockTop[i]?.qty),
    `${o.stock.topItems[0]?.qty} ↔ ${stockTop[0]?.qty}`,
  );

  // ⭐ ÜRETİM KOLONU: `total` TAM SAYIMDIR, önizleme dizisinin uzunluğu DEĞİL.
  // `.length` yazılsaydı her kolon 10'da tavanlanır ve fabrika büyüdükçe rakam
  // sessizce yanlışlaşırdı (önizleme PREVIEW=10).
  const flow = await new InventoryService().getProductionFlow({
    includeQueues: true,
    includeSevk: true,
  });
  const hamCol = o.production?.columns.find((c) => c.key === "hamStok");
  check(
    "üretim: Ham Stok sayımı kaynakla aynı",
    hamCol?.count === flow.data?.hamStok.total,
    `${hamCol?.count} ↔ ${flow.data?.hamStok.total}`,
  );
  check(
    "üretim: sayım ÖNİZLEME uzunluğu değil (PREVIEW tavanı yok)",
    hamCol?.count !== undefined && hamCol.count >= (flow.data?.hamStok.rolls.length ?? 0),
  );
  check(
    "üretim: yedi kolon da geliyor",
    o.production?.columns.length === 7,
    String(o.production?.columns.length),
  );
}

// -----------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("=== FABRİKA ÖZETİ MUTABAKATI ===");
  await sectionNumbers();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

void main();

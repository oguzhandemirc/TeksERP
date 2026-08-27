// =============================================================================
// TeksERP - Müşteri Karnesi (ABC + RFM) bekçisi
// =============================================================================
// Dört iddia:
//
// ① ABC sınıflandırması KÜMÜLATİF paya bakar (%80 / %95), tek tek paya değil.
// ② İKİ ZAMAN KAPSAMI ayrıdır: sıralama/metraj DÖNEME, "sessizlik" ve "ritim"
//    TÜM GEÇMİŞE aittir. Recency dönem içine hapsedilirse 30 günlük pencerede
//    herkes "sessiz" çıkar ve risk listesi anlamsızlaşır.
// ③ RİSK mutlak gün DEĞİL, müşterinin KENDİ ritmine oranıdır. Mutlak eşik
//    (ör. "90 gündür sipariş yok") haftalık alan müşteriyle yılda iki kez alan
//    müşteriyi aynı kefeye koyar.
// ④ Ritim en az 3 sipariş ister ve aralık sayısı n−1'dir. n'e bölmek ritmi
//    sistematik olarak KISA gösterir → herkes riskli görünür.
//
// İZOLASYON: dönem 2019'a kurulur — fabrika verisi 2026'da başlıyor, yani
// dönem-kapsamlı iddialar yalnız bu testin fixture'ını görür. Risk listesi ve
// "dormant" sayacı TANIM GEREĞİ tüm geçmişe bakar; oradaki iddialar bu yüzden
// kendi müşterilerimizin varlığı/yokluğu üzerinden kurulur, toplam sayı
// üzerinden değil (komşu veri onları meşru olarak şişirir).
// =============================================================================

import prisma from "../src/lib/prisma";
import { getCustomerScorecard } from "../src/services/reports/customer-scorecard.report.service";
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
  const TAG = `TEST-CSC-${ts}`;

  try {
    const item = await prisma.item.create({
      data: { code: `${TAG}-I`, name: `${TAG} KUMAS`, itemType: "FABRIC" },
      select: { id: true },
    });
    const mkCustomer = async (suffix: string) =>
      prisma.customer.create({
        data: { code: `${TAG}-${suffix}`, name: `${TAG} ${suffix}` },
        select: { id: true },
      });

    const big = await mkCustomer("BIG");
    const mid = await mkCustomer("MID");
    const small = await mkCustomer("SMALL");
    const risk = await mkCustomer("RISK");
    const thin = await mkCustomer("THIN");

    let seq = 0;
    const mkOrder = async (
      customerId: string,
      isoDate: string,
      qty: number,
      status: "APPROVED" | "CANCELLED" = "APPROVED",
    ) =>
      prisma.order.create({
        data: {
          orderNumber: `${TAG}-${String(++seq).padStart(3, "0")}`,
          customerId,
          status,
          orderDate: new Date(isoDate),
          lines: { create: [{ itemId: item.id, quantity: qty }] },
        },
        select: { id: true },
      });

    // BIG — dönemde 3 sipariş, toplam 800 m. Tarihler 10'ar gün arayla:
    // span 20 gün, aralık sayısı 2 → ritim 10 gün (n'e bölünseydi 6.7 çıkardı).
    await mkOrder(big.id, "2019-06-01T10:00:00.000Z", 300);
    await mkOrder(big.id, "2019-06-11T10:00:00.000Z", 300);
    await mkOrder(big.id, "2019-06-21T10:00:00.000Z", 200);
    // İPTAL — ne metraja ne ritme girmeli.
    await mkOrder(big.id, "2019-06-25T10:00:00.000Z", 5000, "CANCELLED");

    await mkOrder(mid.id, "2019-06-05T10:00:00.000Z", 150);
    await mkOrder(small.id, "2019-06-07T10:00:00.000Z", 50);

    // RISK — 3 sipariş, hepsi DÖNEM DIŞI. Span 90 gün → ritim 45 gün.
    // Son sipariş yıllar önce → oran devasa → risk listesinde OLMALI.
    await mkOrder(risk.id, "2019-01-01T10:00:00.000Z", 100);
    await mkOrder(risk.id, "2019-03-02T10:00:00.000Z", 100);
    await mkOrder(risk.id, "2019-04-01T10:00:00.000Z", 100);

    // THIN — yalnız 2 sipariş → ritim ÖLÇÜLEMEZ → risk listesine GİRMEMELİ.
    await mkOrder(thin.id, "2019-01-01T10:00:00.000Z", 100);
    await mkOrder(thin.id, "2019-02-01T10:00:00.000Z", 100);

    const sc = await getCustomerScorecard(RANGE);
    const row = (suffix: string) => sc.ranking.find((r) => r.customerName === `${TAG} ${suffix}`);
    const rBig = row("BIG");
    const rMid = row("MID");
    const rSmall = row("SMALL");

    console.log("\n── 1) Dönem kapsamı ──");
    check("dönemde 3 müşteri (RISK/THIN dönem dışı)", sc.summary.customerCount === 3, `${sc.summary.customerCount}`);
    check("dönem metrajı = 1000 (iptalin 5000'i yok)", sc.summary.totalQty === 1000, `${sc.summary.totalQty}`);
    check("dönem sipariş adedi = 5", sc.summary.orderCount === 5, `${sc.summary.orderCount}`);

    console.log("\n── 2) ABC kümülatif paya göre ──");
    check("BIG payı %80", rBig?.sharePct === 80, `${rBig?.sharePct}`);
    check("BIG kümülatif %80 → A", rBig?.cumulativePct === 80 && rBig?.abcClass === "A", `${rBig?.cumulativePct}/${rBig?.abcClass}`);
    check("MID kümülatif %95 → B", rMid?.cumulativePct === 95 && rMid?.abcClass === "B", `${rMid?.cumulativePct}/${rMid?.abcClass}`);
    check("SMALL kümülatif %100 → C", rSmall?.cumulativePct === 100 && rSmall?.abcClass === "C", `${rSmall?.cumulativePct}/${rSmall?.abcClass}`);
    check("A sınıfı payı %80", sc.summary.aClassQtyPct === 80, `${sc.summary.aClassQtyPct}`);
    check("sıralama metraja göre DESC", sc.ranking[0]?.customerName === `${TAG} BIG`, sc.ranking[0]?.customerName);

    console.log("\n── 3) Ritim: aralık sayısı n−1 ──");
    // 20 günlük span / (3−1) = 10. n'e bölünseydi 6.7 olurdu.
    check("BIG ritmi 10 gün", rBig?.avgIntervalDays === 10, `${rBig?.avgIntervalDays} (6.7 ise n'e bölünüyor)`);
    check("BIG ömür boyu sipariş = 3 (iptal sayılmaz)", rBig?.lifetimeOrderCount === 3, `${rBig?.lifetimeOrderCount}`);
    check("MID ritmi ölçülemez (tek sipariş)", rMid?.avgIntervalDays === null, `${rMid?.avgIntervalDays}`);

    console.log("\n── 4) Sessizlik TÜM GEÇMİŞTEN (döneme hapsedilmiyor) ──");
    // Dönem 2019'da bitiyor; "sessizlik" bugüne kadarki farktır → yıllar.
    check(
      "BIG sessizliği dönem uzunluğuyla sınırlı DEĞİL (>1000 gün)",
      (rBig?.daysSinceLastOrder ?? 0) > 1000,
      `${rBig?.daysSinceLastOrder} — 30 civarıysa recency döneme hapsedilmiş`,
    );

    console.log("\n── 5) Risk oransal, mutlak gün değil ──");
    const inRisk = (suffix: string) => sc.atRisk.some((r) => r.customerName === `${TAG} ${suffix}`);
    check("RISK listede (ritminin katlarca üstünde sessiz)", inRisk("RISK"));
    check("THIN listede DEĞİL (2 sipariş → ritim ölçülemez)", !inRisk("THIN"));
    const rr = sc.atRisk.find((r) => r.customerName === `${TAG} RISK`);
    check("RISK ritmi 45 gün", rr?.avgIntervalDays === 45, `${rr?.avgIntervalDays}`);
    check("RISK oranı ≥ 2", (rr?.overdueRatio ?? 0) >= 2, `${rr?.overdueRatio}`);
    check(
      "oran = sessiz gün / ritim",
      rr != null && Math.abs(rr.overdueRatio - rr.daysSinceLastOrder / rr.avgIntervalDays) < 0.2,
      `${rr?.overdueRatio} vs ${(rr?.daysSinceLastOrder ?? 0) / (rr?.avgIntervalDays ?? 1)}`,
    );
    // Global sayaçlar komşu veriyi de kapsar → varlık üzerinden, toplam üzerinden değil.
    check("yetersiz geçmişli müşteri sayacı çalışıyor", sc.summary.insufficientHistoryCount >= 1, `${sc.summary.insufficientHistoryCount}`);
    check("dönemde sessiz kalan müşteri sayacı çalışıyor", sc.summary.dormantCount >= 2, `${sc.summary.dormantCount}`);

    console.log("\n── 6) Karşılaştırma dönemi ──");
    const prev: DateRange = {
      from: new Date("2019-01-01T00:00:00.000Z"),
      to: new Date("2019-05-31T23:59:59.999Z"),
    };
    const sc2 = await getCustomerScorecard(RANGE, prev);
    check("önceki dönem müşteri sayısı = 2 (RISK+THIN)", sc2.summary.prevCustomerCount === 2, `${sc2.summary.prevCustomerCount}`);
    check("önceki dönem metrajı = 500", sc2.summary.prevTotalQty === 500, `${sc2.summary.prevTotalQty}`);
    check("dönemde olup öncekinde olmayan müşterinin prevQty = 0", sc2.ranking.find((r) => r.customerName === `${TAG} BIG`)?.prevQty === 0);
  } finally {
    await prisma.order.deleteMany({ where: { orderNumber: { startsWith: TAG } } });
    await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.item.deleteMany({ where: { code: { startsWith: TAG } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

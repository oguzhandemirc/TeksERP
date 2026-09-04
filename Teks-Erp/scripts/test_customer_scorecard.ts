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
// ⑤ (2026-09-04) GİRİŞ ALIŞKANLIĞI ile MÜŞTERİ DAVRANIŞI ayrı ölçülür.
//    Fabrikada bazı siparişler kalem kalem, bazıları tek tek giriliyor. Aynı
//    işi veren iki müşteri "sipariş adedi"nde 1'e 10 görünür. §7 tam bu iki
//    müşteriyi yan yana kurar ve şunu kilitler: `orderCount` AYRIŞIR (öyle
//    olmalı — belge sayısıdır), ama `lineCount` · `totalQty` · `orderDayCount`
//    AYNI kalır (aynı iş, aynı gün, aynı metraj) ve `avgLinesPerOrder` ikisini
//    AYIRT EDER. Bu bekçi düşerse rapor makul görünen ama yanlış bir sıralama
//    basar — sessiz sınıf hata.
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

    // =========================================================================
    // 7) GİRİŞ ALIŞKANLIĞI — "1 sipariş 10 kalem" ile "10 sipariş 1 kalem"
    // =========================================================================
    // AYRI DÖNEM (2018) kurulur: bu müşterilerin metrajı 2019 fixture'ının ABC
    // dengesini bozardı ve §2'nin sayıları sessizce kayardı.
    console.log("\n── 7) Giriş alışkanlığı: belge sayısı ≠ verilen iş ──");
    const H: DateRange = {
      from: new Date("2018-06-01T00:00:00.000Z"),
      to: new Date("2018-06-30T23:59:59.999Z"),
    };
    const color = await prisma.color.create({
      data: { code: `${TAG}-C`, name: `${TAG} MAVI` },
      select: { id: true },
    });

    const hMulti = await mkCustomer("HMULTI");
    const hSingle = await mkCustomer("HSINGLE");
    const hDays = await mkCustomer("HDAYS");
    const hCancel = await mkCustomer("HCANCEL");

    /** Tek siparişte N kalem — "kalem kalem giren" müşteri. */
    await prisma.order.create({
      data: {
        orderNumber: `${TAG}-H1`,
        customerId: hMulti.id,
        status: "APPROVED",
        orderDate: new Date("2018-06-10T09:00:00.000Z"),
        lines: {
          create: Array.from({ length: 10 }, () => ({
            itemId: item.id,
            colorId: color.id,
            quantity: 100,
          })),
        },
      },
    });

    /** AYNI GÜN 10 ayrı sipariş, her biri tek kalem — "tek tek giren" müşteri.
     *  Metraj, kalem sayısı ve GÜN birebir aynı; ayrışan tek şey belge sayısı. */
    for (let i = 0; i < 10; i++) {
      await prisma.order.create({
        data: {
          orderNumber: `${TAG}-H2-${i}`,
          customerId: hSingle.id,
          status: "APPROVED",
          orderDate: new Date(`2018-06-10T1${i}:00:00.000Z`),
          lines: { create: [{ itemId: item.id, colorId: color.id, quantity: 100 }] },
        },
      });
    }

    /** ÜÇ AYRI GÜN — "sipariş günü" sayacının gerçekten gün saydığını ölçer. */
    for (const d of ["2018-06-12", "2018-06-13", "2018-06-14"]) {
      await mkOrder(hDays.id, `${d}T09:00:00.000Z`, 10);
      // mkOrder tarih dışında aynı şablonu kullanır; müşterisi hDays.
    }

    /** İPTAL: bir kalem iptal (100), bir sipariş tümüyle iptal (300).
     *  Aktif kalan 100 → iptal oranı 400/500 = %80. */
    await prisma.order.create({
      data: {
        orderNumber: `${TAG}-H4`,
        customerId: hCancel.id,
        status: "APPROVED",
        orderDate: new Date("2018-06-15T09:00:00.000Z"),
        lines: {
          create: [
            { itemId: item.id, quantity: 100 },
            { itemId: item.id, quantity: 100, cancelledAt: new Date("2018-06-16T09:00:00.000Z") },
          ],
        },
      },
    });
    await mkOrder(hCancel.id, "2018-06-15T15:00:00.000Z", 300, "CANCELLED");

    const hc = await getCustomerScorecard(H);
    const hrow = (suffix: string) => hc.ranking.find((r) => r.customerName === `${TAG} ${suffix}`);
    const M = hrow("HMULTI");
    const S = hrow("HSINGLE");
    const D = hrow("HDAYS");
    const C = hrow("HCANCEL");

    // ── Ayrışması GEREKEN tek sayı: belge adedi ──
    check("belge adedi ayrışıyor (1 vs 10) — 'sipariş adedi' giriş alışkanlığını ölçer",
      M?.orderCount === 1 && S?.orderCount === 10, `${M?.orderCount} vs ${S?.orderCount}`);

    // ── AYNI olması GEREKEN üç sayı: aynı iş, aynı metraj, aynı gün ──
    check("kalem adedi AYNI (10 = 10) — 'kaç ayrı mal istedi' belgeden bağımsız",
      M?.lineCount === 10 && S?.lineCount === 10, `${M?.lineCount} vs ${S?.lineCount}`);
    check("metraj AYNI (1000 = 1000)",
      M?.totalQty === 1000 && S?.totalQty === 1000, `${M?.totalQty} vs ${S?.totalQty}`);
    check("sipariş GÜNÜ AYNI (1 = 1) — aynı gün girilen 10 sipariş tek temas",
      M?.orderDayCount === 1 && S?.orderDayCount === 1,
      `${M?.orderDayCount} vs ${S?.orderDayCount} — 10 ise gün değil BELGE sayılıyor`);

    // ── Ayırt edici sayı ──
    check("kalem/sipariş iki alışkanlığı AYIRT EDİYOR (10 vs 1)",
      M?.avgLinesPerOrder === 10 && S?.avgLinesPerOrder === 1,
      `${M?.avgLinesPerOrder} vs ${S?.avgLinesPerOrder}`);

    // ── ABC alışkanlıktan ETKİLENMEZ ──
    check("eşit metrajlı iki müşteri eşit pay alıyor (ABC belge sayısına kaymıyor)",
      M?.sharePct === S?.sharePct, `${M?.sharePct} vs ${S?.sharePct}`);

    console.log("\n── 7b) Sipariş günü gerçekten GÜN sayıyor ──");
    check("üç ayrı günde sipariş → 3 gün", D?.orderDayCount === 3, `${D?.orderDayCount}`);
    check("üç ayrı günde sipariş → 3 belge", D?.orderCount === 3, `${D?.orderCount}`);

    console.log("\n── 7c) İptal: aktif işe girmez, orana girer ──");
    check("iptal kalem metraja girmedi (100, 200 değil)", C?.totalQty === 100, `${C?.totalQty}`);
    check("iptal kalem kalem sayısına girmedi (1)", C?.lineCount === 1, `${C?.lineCount}`);
    check("iptal sipariş belge sayısına girmedi (1)", C?.orderCount === 1, `${C?.orderCount}`);
    check("iptal metrajı = 400 (kalem 100 + belge 300)", C?.cancelledQty === 400, `${C?.cancelledQty}`);
    check("iptal oranı %80 (400 / 500)", C?.cancelRatePct === 80, `${C?.cancelRatePct}`);
    check("iptal sipariş sipariş GÜNÜNE de girmedi (1 gün)", C?.orderDayCount === 1, `${C?.orderDayCount}`);
    check("iptal belge sayacı = 1", hc.summary.cancelledOrderCount === 1, `${hc.summary.cancelledOrderCount}`);

    console.log("\n── 7d) Zenginleştirmeler ──");
    check("favori renk çözülüyor", M?.topColorName === `${TAG} MAVI`, `${M?.topColorName}`);
    check("ilk sipariş tarihi dolu", Boolean(M?.firstOrderDate));
    check("özet kalem adedi = 24 (10+10+3+1)", hc.summary.lineCount === 24, `${hc.summary.lineCount}`);
    check("özet kalem/sipariş = 24/15 = 1.6", hc.summary.avgLinesPerOrder === 1.6, `${hc.summary.avgLinesPerOrder}`);
    check("sevk sütunu var ve sayı (fixture'da sevk yok → 0)", M?.shippedQty === 0, `${M?.shippedQty}`);
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

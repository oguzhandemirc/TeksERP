// =============================================================================
// TeksERP - Sipariş İptal Karnesi bekçisi
// =============================================================================
// ① ÇIPA `cancelledAt` — `orderDate` DEĞİL. Sipariş Ocak'ta alınıp Mart'ta iptal
//    edilebilir; yanlış çıpa Mart'ın gerçeğini Ocak'a yazar ve iki ay birden
//    yanlışlanır. Test iki yönlü sonda kurar (içeride alınıp dışarıda iptal
//    edilen ve tersi).
// ② SEBEPSİZ ve SERBEST METİNLİ iptaller AYRI, ADLANDIRILMIŞ kovalarda durur.
//    Tek kovada toplanırlarsa "sebep girme alışkanlığı" ölçülemez; gizlenirlerse
//    dağılım gerçekte olduğundan temiz görünür.
// ③ DAMGASIZ ESKİ İPTALLER dönem raporuna girmez ama SAYILIR. Sessizce
//    düşselerdi "geçmişte hiç iptal olmamış" yanılgısı doğardı.
// ④ Maliyet vekilleri: `daysToCancel` (geç iptal pahalıdır) ve
//    `afterShipmentCount` (sevk başladıktan sonraki iptal en pahalısı).
//
// İZOLASYON: 2019 penceresi (fabrika verisi 2026'da). `undatedCancelCount`
// TANIM GEREĞİ tüm tabloyu sayar → orada iddia ">=" ile kurulur.
// =============================================================================

import prisma from "../src/lib/prisma";
import { getOrderCancellationScorecard, NO_REASON_KEY } from "../src/services/reports/order-cancellation.report.service";
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
  const TAG = `TEST-CANC-${ts}`;

  try {
    const customer = await prisma.customer.create({
      data: { code: `${TAG}-C`, name: `${TAG} MUSTERI` },
      select: { id: true },
    });
    const item = await prisma.item.create({
      data: { code: `${TAG}-I`, name: `${TAG} KUMAS`, itemType: "FABRIC" },
      select: { id: true },
    });

    let seq = 0;
    const mk = async (opts: {
      orderDate: string;
      cancelledAt: string | null;
      qty: number;
      reasonCode?: string | null;
      reasonText?: string | null;
      shippedQty?: number;
      status?: "CANCELLED" | "APPROVED";
    }) =>
      prisma.order.create({
        data: {
          orderNumber: `${TAG}-${String(++seq).padStart(3, "0")}`,
          customerId: customer.id,
          status: opts.status ?? "CANCELLED",
          orderDate: new Date(opts.orderDate),
          ...(opts.cancelledAt ? { cancelledAt: new Date(opts.cancelledAt) } : {}),
          ...(opts.reasonCode ? { cancelReasonCode: opts.reasonCode } : {}),
          ...(opts.reasonText ? { cancelReason: opts.reasonText } : {}),
          ...(opts.shippedQty ? { shippedQty: opts.shippedQty } : {}),
          lines: { create: [{ itemId: item.id, quantity: opts.qty }] },
        },
        select: { id: true },
      });

    // A: dönem İÇİNDE iptal, sipariş dönem DIŞINDA alınmış → SAYILMALI (10 gün)
    await mk({ orderDate: "2019-05-25T09:00:00.000Z", cancelledAt: "2019-06-04T09:00:00.000Z", qty: 100, reasonCode: "FIYAT", reasonText: "Fiyatta anlaşılamadı" });
    // B: sipariş dönem İÇİNDE, iptal dönem DIŞINDA → SAYILMAMALI
    await mk({ orderDate: "2019-06-10T09:00:00.000Z", cancelledAt: "2019-07-15T09:00:00.000Z", qty: 9999, reasonCode: "TERMIN" });
    // C: sebepsiz iptal
    await mk({ orderDate: "2019-06-01T09:00:00.000Z", cancelledAt: "2019-06-02T09:00:00.000Z", qty: 200 });
    // D: serbest metinli (kodsuz) iptal
    await mk({ orderDate: "2019-06-01T09:00:00.000Z", cancelledAt: "2019-06-03T09:00:00.000Z", qty: 300, reasonText: `${TAG} özel gerekçe` });
    // E: SEVK BAŞLADIKTAN SONRA iptal — en pahalı sınıf, 40 gün sonra
    await mk({ orderDate: "2019-05-20T09:00:00.000Z", cancelledAt: "2019-06-29T09:00:00.000Z", qty: 400, shippedQty: 150, reasonCode: "MUSTERI_VAZGECTI" });
    // F: DAMGASIZ eski iptal → dönem raporuna girmez, sayılır
    await mk({ orderDate: "2019-06-05T09:00:00.000Z", cancelledAt: null, qty: 500 });
    // G: iptal edilmemiş sipariş (oranın paydası için)
    await mk({ orderDate: "2019-06-05T09:00:00.000Z", cancelledAt: null, qty: 50, status: "APPROVED" });

    const r = await getOrderCancellationScorecard(RANGE);
    const mine = r.orders.filter((o) => o.orderNumber.startsWith(TAG));

    console.log("\n── 1) Çıpa cancelledAt ──");
    check("dönemde iptal edilen 4 kayıt (A, C, D, E)", mine.length === 4, `${mine.length}`);
    check(
      "dönem DIŞINDA iptal edilen (B) SAYILMADI",
      !mine.some((o) => o.qty === 9999),
      "9999 görünüyorsa çıpa orderDate'e kaymış",
    );
    check(
      "dönem DIŞINDA alınıp içeride iptal edilen (A) SAYILDI",
      mine.some((o) => o.qty === 100),
      "yoksa çıpa orderDate",
    );

    console.log("\n── 2) Gün hesabı ve maliyet vekilleri ──");
    const a = mine.find((o) => o.qty === 100);
    check("A: sipariş→iptal 10 gün", a?.daysToCancel === 10, `${a?.daysToCancel}`);
    const e = mine.find((o) => o.qty === 400);
    check("E: sipariş→iptal 40 gün", e?.daysToCancel === 40, `${e?.daysToCancel}`);
    check("en geç iptal listede ÜSTTE", mine[0]?.qty === 400, `${mine[0]?.qty}`);
    check("sevk sonrası iptal sayacı 1", r.summary.afterShipmentCount === 1, `${r.summary.afterShipmentCount}`);
    check("sevk sonrası iptal metrajı 400", r.summary.afterShipmentQty === 400, `${r.summary.afterShipmentQty}`);

    console.log("\n── 3) Sebep kovaları ayrı ve adlandırılmış ──");
    const bucket = (code: string) => r.byReason.find((b) => b.code === code);
    check("kodsuz kova var", Boolean(bucket(NO_REASON_KEY)), r.byReason.map((b) => b.code).join(","));
    // C (sebepsiz) + D (serbest metin) aynı kodsuz kovada ama etiketleri farklı
    // olabilir; ikisinin de kod taşımadığı kesin.
    check("kodsuz kovada 2 iptal (sebepsiz + serbest metin)", bucket(NO_REASON_KEY)?.count === 2, `${bucket(NO_REASON_KEY)?.count}`);
    check("FIYAT kovası 1", bucket("FIYAT")?.count === 1, `${bucket("FIYAT")?.count}`);
    check("MUSTERI_VAZGECTI kovası 1", bucket("MUSTERI_VAZGECTI")?.count === 1, `${bucket("MUSTERI_VAZGECTI")?.count}`);
    check("katalog etiketi kullanıldı (kod değil)", bucket("FIYAT")?.label === "Fiyat anlaşmazlığı", `${bucket("FIYAT")?.label}`);
    check("sebep doluluk oranı %50 (4'ün 2'si kodlu)", r.summary.reasonFillPct === 50, `${r.summary.reasonFillPct}`);

    console.log("\n── 4) Damgasız eski iptaller: dışarıda ama SAYILI ──");
    check(
      "F dönem listesinde YOK",
      !mine.some((o) => o.qty === 500),
      "damgasız iptal rapora sızıyor",
    );
    check("damgasız iptal sayacı çalışıyor", r.summary.undatedCancelCount >= 1, `${r.summary.undatedCancelCount}`);

    console.log("\n── 5) Müşteri kırılımı ──");
    const cust = r.byCustomer.find((c) => c.customerName === `${TAG} MUSTERI`);
    check("müşteri kovası var", Boolean(cust));
    check("müşteri iptal adedi 4", cust?.count === 4, `${cust?.count}`);
    check("en sık sebebi etiketlendi", Boolean(cust?.topReasonLabel), `${cust?.topReasonLabel}`);
    // Dönemde AÇILAN siparişler: B, C, D, F, G = 5 (A ve E mayısta alındı)
    check("oranın paydası dönemde AÇILAN siparişler", cust?.cancelRatePct === 80, `${cust?.cancelRatePct} (4/5)`);

    console.log("\n── 6) Günlük seri ──");
    const days = r.daily.filter((d) => d.day.startsWith("2019-06"));
    check("günlük seri dolu", days.length >= 3, `${days.length}`);
    check(
      "günlük toplam = dönem toplamı",
      r.daily.reduce((s, d) => s + d.count, 0) === r.summary.cancelledCount,
      `${r.daily.reduce((s, d) => s + d.count, 0)} vs ${r.summary.cancelledCount}`,
    );
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

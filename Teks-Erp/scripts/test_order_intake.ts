// =============================================================================
// TeksERP - Sipariş Karnesi (giriş tarafı) bekçisi
// =============================================================================
// Üç iddia, üçü de sessizce bozulabilecek cinsten:
//
// ① ÇIPA `orderDate` — `createdAt` DEĞİL. Kâğıttan geç girilen sipariş, işin
//    ALINDIĞI aya yazılmalı. Çıpa kayarsa rapor hâlâ "makul" görünür (sayılar
//    yakın çıkar) ama ay sonu rakamı yanlış aya düşer; kimse fark etmez.
// ② ADET iptalleri SAYAR, METRAJ saymaz. İkisini aynı paydaya çekmek cazip ama
//    yanlış: iptal oranı ölçülemez hale gelir ya da iptal edilmiş siparişin
//    metrajı üretim planına girer.
// ③ Müşteri kırılımında `count` = SİPARİŞ adedi, kumaş kırılımında = KALEM.
//    Tek hücre kümesi kullanılsaydı çok kalemli sipariş müşteriyi N kez sayardı.
// =============================================================================

import prisma from "../src/lib/prisma";
import { getOrderIntake } from "../src/services/reports/order-intake.report.service";
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

// Komşu veriden izolasyon: fabrika verisinin ULAŞAMAYACAĞI gelecek penceresi
// (mevcut karne bekçilerinin deseni).
const FROM = new Date("2095-06-01T00:00:00.000Z");
const TO = new Date("2095-06-30T23:59:59.999Z");
const RANGE: DateRange = { from: FROM, to: TO };
const OUTSIDE = new Date("2095-05-01T12:00:00.000Z");

async function main(): Promise<void> {
  const ts = Date.now();
  const TAG = `TEST-INTAKE-${ts}`;

  try {
    const customer = await prisma.customer.create({
      data: { code: `${TAG}-C`, name: `${TAG} MUSTERI` },
      select: { id: true },
    });
    const i1 = await prisma.item.create({
      data: { code: `${TAG}-I1`, name: `${TAG} KUMAS1`, itemType: "FABRIC" },
      select: { id: true },
    });
    const i2 = await prisma.item.create({
      data: { code: `${TAG}-I2`, name: `${TAG} KUMAS2`, itemType: "FABRIC" },
      select: { id: true },
    });

    const mk = async (
      no: string,
      status: "APPROVED" | "CANCELLED",
      orderDate: Date,
      lines: Array<{ itemId: string; quantity: number }>,
      opts: { createdAt?: Date; deadline?: Date } = {},
    ) =>
      prisma.order.create({
        data: {
          orderNumber: `${TAG}-${no}`,
          customerId: customer.id,
          status,
          orderDate,
          ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
          ...(opts.deadline ? { deadline: opts.deadline } : {}),
          lines: { create: lines },
        },
        select: { id: true },
      });

    const IN = new Date("2095-06-10T09:00:00.000Z");
    // A: iki KALEMLİ sipariş → müşteri 1 kez, kumaş 2 kez sayılmalı
    await mk("A", "APPROVED", IN, [
      { itemId: i1.id, quantity: 100 },
      { itemId: i2.id, quantity: 200 },
    ], { deadline: new Date("2095-07-10T00:00:00.000Z") });
    // B: tek kalem
    await mk("B", "APPROVED", IN, [{ itemId: i1.id, quantity: 300 }]);
    // C: İPTAL — adete girer, metraja GİRMEZ
    await mk("C", "CANCELLED", IN, [{ itemId: i1.id, quantity: 9999 }]);
    // D: ÇIPA SONDASI — createdAt aralık DIŞINDA, orderDate İÇİNDE → SAYILMALI
    await mk("D", "APPROVED", IN, [{ itemId: i1.id, quantity: 50 }], { createdAt: OUTSIDE });
    // E: TERS ÇIPA — createdAt aralık İÇİNDE, orderDate DIŞINDA → SAYILMAMALI
    await mk("E", "APPROVED", OUTSIDE, [{ itemId: i1.id, quantity: 7777 }], {
      createdAt: IN,
    });

    const r = await getOrderIntake(RANGE);

    console.log("\n── 1) Çıpa orderDate (createdAt değil) ──");
    check("orderDate içeride olan sipariş SAYILDI (createdAt dışarıda olsa da)", r.summary.orderCount === 4, `orderCount=${r.summary.orderCount}`);
    check(
      "orderDate dışarıda olan sipariş SAYILMADI (createdAt içeride olsa da)",
      r.summary.totalQty === 650,
      `totalQty=${r.summary.totalQty} — 8427 ise createdAt çıpası kullanılıyor`,
    );

    console.log("\n── 2) Adet iptali sayar, metraj saymaz ──");
    check("iptal adedi = 1", r.summary.cancelledCount === 1, `${r.summary.cancelledCount}`);
    check("aktif sipariş = 3", r.summary.activeOrderCount === 3, `${r.summary.activeOrderCount}`);
    check("iptal oranı = 25%", r.summary.cancelledPct === 25, `${r.summary.cancelledPct}`);
    check(
      "iptal metrajı (9999) toplamda YOK",
      r.summary.totalQty === 650,
      `${r.summary.totalQty}`,
    );

    console.log("\n── 3) Ortalamanın paydası aktif sipariş ──");
    // 650 / 3 = 216.7 — iptal dahil edilseydi 650/4 = 162.5 olurdu.
    check("ortalama sipariş büyüklüğü = 216.7", r.summary.avgOrderQty === 216.7, `${r.summary.avgOrderQty}`);
    check("kalem adedi = 4 (iptalin kalemi hariç)", r.summary.lineCount === 4, `${r.summary.lineCount}`);
    check("sipariş başına kalem = 1.3", r.summary.avgLinesPerOrder === 1.3, `${r.summary.avgLinesPerOrder}`);
    check("termin verilmiş = 1", r.summary.withDeadlineCount === 1, `${r.summary.withDeadlineCount}`);
    check("müşteri sayısı = 1", r.summary.customerCount === 1, `${r.summary.customerCount}`);

    console.log("\n── 4) Kırılımların sayım birimi FARKLI ──");
    const cust = r.byCustomer.find((b) => b.label === `${TAG} MUSTERI`);
    check("müşteri kovası var", Boolean(cust));
    check(
      "müşteri count = SİPARİŞ adedi (3), kalem adedi (4) DEĞİL",
      cust?.count === 3,
      `${cust?.count}`,
    );
    check("müşteri qty = 650", cust?.qty === 650, `${cust?.qty}`);
    const it1 = r.byItem.find((b) => b.label === `${TAG} KUMAS1`);
    const it2 = r.byItem.find((b) => b.label === `${TAG} KUMAS2`);
    check("kumaş1 count = KALEM adedi (3)", it1?.count === 3, `${it1?.count}`);
    check("kumaş1 qty = 450 (100+300+50)", it1?.qty === 450, `${it1?.qty}`);
    check("kumaş2 count = 1, qty = 200", it2?.count === 1 && it2?.qty === 200, `${it2?.count}/${it2?.qty}`);
    check(
      "iki kırılımın metrajı AYNI toplamı verir",
      r.byCustomer.reduce((s, b) => s + b.qty, 0) === r.byItem.reduce((s, b) => s + b.qty, 0),
    );

    console.log("\n── 5) Günlük seri ──");
    const day = r.daily.find((d) => d.day === "2095-06-10");
    check("gün satırı var", Boolean(day), JSON.stringify(r.daily));
    check("günde 3 sipariş (iptal hariç)", day?.orderCount === 3, `${day?.orderCount}`);
    check("günde 650 m", day?.qty === 650, `${day?.qty}`);
    check("seri yalnız dolu günleri taşır", r.daily.length === 1, `${r.daily.length}`);

    console.log("\n── 6) Karşılaştırma dönemi ──");
    const prevRange: DateRange = {
      from: new Date("2095-05-01T00:00:00.000Z"),
      to: new Date("2095-05-31T23:59:59.999Z"),
    };
    const r2 = await getOrderIntake(RANGE, prevRange);
    check("önceki dönem sipariş adedi = 1 (E)", r2.summary.prevOrderCount === 1, `${r2.summary.prevOrderCount}`);
    check("önceki dönem metrajı = 7777", r2.summary.prevTotalQty === 7777, `${r2.summary.prevTotalQty}`);
    const cust2 = r2.byCustomer.find((b) => b.label === `${TAG} MUSTERI`);
    check("kırılıma prev işlendi", cust2?.prevQty === 7777, `${cust2?.prevQty}`);
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

// =============================================================================
// TeksERP - Sipariş → Teslim Süresi bekçisi
// =============================================================================
// ① MEDYAN ≠ ORTALAMA. Tek bir felaket sipariş ortalamayı uçurur; termin sözü
//    ortalamaya dayandırılırsa siparişlerin yarısında tutmaz. Test bilerek
//    çarpık bir örneklem kurar ve ikisinin AYRIŞTIĞINI ölçer — eşit çıkarsa
//    ya medyan ortalamaya çevrilmiştir ya da örneklem çarpık değildir.
// ② ÇIPA `orderDate`; `createdAt` DEĞİL. Geç girilen sipariş kendiliğinden
//    "hızlı teslim edilmiş" görünmemeli.
// ③ HİÇ SEVK GÖRMEYEN sipariş istatistiğe GİRMEZ ama SAYILIR. İstatistiğe
//    girseydi 0 gün gibi davranır ve medyanı aşağı çekerdi; sessizce elenseydi
//    "her şey zamanında çıkıyor" yanılgısı doğardı.
// ④ `LEAST(çuval, fason)` — iki sevk kaynağının ERKENİ. PostgreSQL'de
//    LEAST NULL'ları ATLAR; bu davranış load-bearing çünkü fasondan doğrudan
//    çıkan siparişin çuval tarafı NULL'dur ve naif bir toplama onu "hiç sevk
//    edilmemiş" gösterirdi.
//
// ⚠️ KAPSAM BOŞLUĞU (bilerek yazılı): fason doğrudan sevk dalı FIXTURE ile
//    kurulmuyor — `DirectShipment.dispatchId` tam bir fason sevk zinciri ister.
//    O dalın davranışı ④'te SQL semantiği düzeyinde ölçülüyor; uçtan uca
//    fixture'ı gerektiren bir regresyon çıkarsa buraya eklenmeli.
// =============================================================================

import prisma from "../src/lib/prisma";
import { Prisma } from "@prisma/client";
import { getOrderLeadTime, MIN_SAMPLE } from "../src/services/reports/order-leadtime.report.service";
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

const DAY = 86_400_000;
const BASE = new Date("2019-06-05T09:00:00.000Z");
const RANGE: DateRange = {
  from: new Date("2019-06-01T00:00:00.000Z"),
  to: new Date("2019-06-30T23:59:59.999Z"),
};

async function main(): Promise<void> {
  const ts = Date.now();
  const TAG = `TEST-LT-${ts}`;
  // Defter satırları (SackAllocation) KİMLİKLE silinir — çuval id'leri burada toplanır (§10b).
  const sackIds: string[] = [];

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
    const mk = async (closeAfterDays: number | null, opts: { createdAt?: Date } = {}) => {
      const o = await prisma.order.create({
        data: {
          orderNumber: `${TAG}-${String(++seq).padStart(3, "0")}`,
          customerId: customer.id,
          status: closeAfterDays === null ? "APPROVED" : "COMPLETED",
          orderDate: BASE,
          ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
          ...(closeAfterDays !== null
            ? { completedAt: new Date(BASE.getTime() + closeAfterDays * DAY) }
            : {}),
          lines: { create: [{ itemId: item.id, quantity: 100 }] },
        },
        select: { id: true, lines: { select: { id: true } } },
      });
      return o;
    };

    // ÇARPIK ÖRNEKLEM: 1, 2, 3, 4, 100 gün.
    //   medyan (nearest rank p50) = 3 · ortalama = 22 → ikisi AYRIŞIR.
    //   p90 = 100 · min 1 · max 100
    for (const d of [1, 2, 3, 4, 100]) await mk(d);
    // Hiç sevk görmemiş + hiç kapanmamış sipariş.
    const openOrder = await mk(null);
    // ÇIPA SONDASI: createdAt aralık DIŞINDA, orderDate İÇİNDE → sayılmalı.
    await mk(2, { createdAt: new Date("2019-01-01T00:00:00.000Z") });

    // ── Çuval sevkiyatı: kapanan siparişlerden birine 7 gün sonra ilk sevk ──
    const shipped = await mk(20);
    const shipment = await prisma.shipment.create({
      data: {
        shipmentNo: `${TAG}-SHP`,
        customerId: customer.id,
        status: "DISPATCHED",
        dispatchedAt: new Date(BASE.getTime() + 7 * DAY),
      },
      select: { id: true },
    });
    const sack = await prisma.sack.create({
      data: { sackNo: `${TAG}-CV`, customerId: customer.id, shipmentId: shipment.id },
      select: { id: true },
    });
    sackIds.push(sack.id);
    await prisma.sackAllocation.create({
      data: { sackId: sack.id, orderLineId: shipped.lines[0]!.id, qty: 50 },
    });

    const r = await getOrderLeadTime(RANGE);

    console.log("\n── 1) Medyan ≠ ortalama (çarpık örneklem) ──");
    // 8 sipariş: 7'si kapanmış (1,2,3,4,100,2,20), 1'i açık.
    // sıralı: 1,2,2,3,4,20,100 → medyan (nearest rank, n=7 → rank 4) = 3
    check("tam kapanış örneklemi 7", r.fullClose.sampleSize === 7, `${r.fullClose.sampleSize}`);
    check("medyan = 3 gün", r.fullClose.medianDays === 3, `${r.fullClose.medianDays}`);
    check(
      "ortalama medyandan BELİRGİN büyük (çarpıklık görünüyor)",
      (r.fullClose.avgDays ?? 0) > (r.fullClose.medianDays ?? 0) * 3,
      `ort=${r.fullClose.avgDays} medyan=${r.fullClose.medianDays}`,
    );
    check("p90 = 100 gün", r.fullClose.p90Days === 100, `${r.fullClose.p90Days}`);
    check("min 1 / max 100", r.fullClose.minDays === 1 && r.fullClose.maxDays === 100, `${r.fullClose.minDays}/${r.fullClose.maxDays}`);

    console.log("\n── 2) İlk sevk süresi ──");
    check("ilk sevk örneklemi 1", r.firstShip.sampleSize === 1, `${r.firstShip.sampleSize}`);
    check("ilk sevk 7 gün", r.firstShip.medianDays === 7, `${r.firstShip.medianDays}`);
    const shippedRow = r.orders.find((o) => o.orderNumber === `${TAG}-${String(seq).padStart(3, "0")}`);
    check("sevk edilen siparişin firstShipDays'i dolu", shippedRow?.firstShipDays === 7, `${shippedRow?.firstShipDays}`);

    console.log("\n── 3) Hiç sevk görmeyen: istatistik DIŞI, sayaç İÇİ ──");
    check("hiç sevk görmeyen 7 (8 siparişin 7'si)", r.neverShippedCount === 7, `${r.neverShippedCount}`);
    check(
      "sevk görmeyenler ilk-sevk istatistiğine GİRMEDİ",
      r.firstShip.sampleSize === 1,
      "7 olsaydı 0 gün gibi sayılıp medyanı çökertirdi",
    );
    const open = r.orders.find((o) => o.orderId === openOrder.id);
    check("açık siparişte openDays dolu", (open?.openDays ?? 0) > 1000, `${open?.openDays}`);
    check("açık siparişte firstShipDays null", open?.firstShipDays === null, `${open?.firstShipDays}`);

    console.log("\n── 4) Çıpa orderDate ──");
    check("8 sipariş sayıldı (createdAt dışarıdaki dahil)", r.orders.length === 8, `${r.orders.length}`);

    console.log("\n── 5) LEAST NULL'ları atlar (fason dalının dayanağı) ──");
    const least = await prisma.$queryRaw<Array<{ a: Date | null; b: Date | null }>>(Prisma.sql`
      SELECT LEAST(NULL::timestamptz, '2019-06-10'::timestamptz) AS a,
             LEAST('2019-06-20'::timestamptz, '2019-06-10'::timestamptz) AS b
    `);
    check(
      "LEAST(NULL, tarih) = tarih — tek kaynaklı sevk 'hiç sevk edilmemiş' görünmez",
      least[0]?.a?.toISOString().slice(0, 10) === "2019-06-10",
      `${least[0]?.a}`,
    );
    check("LEAST iki tarihin ERKENİNİ verir", least[0]?.b?.toISOString().slice(0, 10) === "2019-06-10", `${least[0]?.b}`);

    console.log("\n── 6) Yetersiz örneklem gizlenmiyor ──");
    check("minSample sözleşmede dönüyor", r.minSample === MIN_SAMPLE, `${r.minSample}`);
    check("ilk sevk örneklemi eşiğin ALTINDA (istemci uyarı basmalı)", r.firstShip.sampleSize < r.minSample);
    const cust = r.byCustomer.find((b) => b.label === `${TAG} MUSTERI`);
    check("müşteri kırılımında da sampleSize var", cust?.fullClose.sampleSize === 7, `${cust?.fullClose.sampleSize}`);
  } finally {
    if (sackIds.length > 0) await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } });
    await prisma.sack.deleteMany({ where: { sackNo: { startsWith: TAG } } });
    await prisma.shipment.deleteMany({ where: { shipmentNo: { startsWith: TAG } } });
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

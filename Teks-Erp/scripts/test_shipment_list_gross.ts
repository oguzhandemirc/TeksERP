// =============================================================================
// Test: Sevkiyat LİSTESİ de BRÜT'tür — metraj + top adedi iade sonrası düşmez
// Çalıştır: npx tsx scripts/test_shipment_list_gross.ts
//
// `test_dispatch_report_gross.ts` fişin/irsaliyenin brütlüğünü kilitler. Bu test
// LİSTE yüzeyini kilitler — 2026-08-02 denetiminde açık kalan taraf:
//   • `RollReturn` topun `shipmentId`'sini NULL'lar (return.service.ts:324-325),
//     dolayısıyla `_count.rolls` CANLI/NET idi → donmuş irsaliye "2 top" derken
//     liste "1 top" diyordu (metrajda çözülen sorunun adet ikizi).
//   • Muhasebe ekranında metraj hiç yoktu; eklenirken canlı toplansaydı aynı
//     SVK2007260001 vakası (501 ↔ 452) bu kez listede doğardı.
//
// Kilitlenen sözleşmeler:
//   1) Liste metrajı = canlı + iptal edilmemiş iade (BRÜT) → fişle birebir.
//   2) Liste top adedi = canlı + iade adedi (BRÜT).
//   3) İade bilgisi kaybolmaz — `_count.returns` ayrı alanda durur.
//   4) İade İPTAL edilince geri-ekleme de düşer (çift sayım yok).
//   5) Kg iade geri-eklemesi İSTEMEZ (tartı sevk anında donmuş çuval değeri).
//   6) `withSummary=true` dönem bandı satırlarla AYNI brüt sözleşmesini taşır.
//
// Negatif özellik yerleşik: 1. ve 2. maddeler "raporlanan ≠ canlı" olduğunu da
// doğrular — geri-ekleme kaldırılırsa bu iki kontrol kırmızı verir.
// =============================================================================
import { PrintedDocType } from "@prisma/client";
import type { Request } from "express";
import prisma from "../src/lib/prisma";
import { printedDocumentService } from "../src/services/printed-document.service";
import { shippingService } from "../src/services/shipping.service";
import { returnService } from "../src/services/return.service";

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

interface ListRow {
  id: string;
  shipmentNo: string;
  totalMeters: number;
  totalKg: number;
  _count: { sacks: number; rolls: number; orders: number; returns: number };
}
interface ListResult {
  data: ListRow[];
  summary?: { shipmentCount: number; totalMeters: number; totalKg: number };
}

const fakeReq = (query: Record<string, string>) => ({ query }) as unknown as Request;

async function main() {
  const ts = Date.now();
  const user = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!user) throw new Error("Seed kullanıcısı 'admin' yok — önce `npm run seed`.");

  // Fixture'ı test kendi yaratır (dev DB verisine BAĞIMLI OLMA kuralı).
  const customer = await prisma.customer.create({
    data: { code: `TST-SLG-${ts}`, name: "TEST SLG MÜŞTERİ", taxNumber: "9998887776" },
    select: { id: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-SLG-I-${ts}`, name: "SLG KUMAŞ", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const color = await prisma.color.create({
    data: { code: `TST-SLG-C-${ts}`, name: "SLG EKRU" },
    select: { id: true },
  });
  const shipment = await prisma.shipment.create({
    data: {
      shipmentNo: `TEST-SLG-${ts}`,
      customerId: customer.id,
      status: "DISPATCHED",
      destination: "DOMESTIC",
      dispatchedAt: new Date(),
    },
    select: { id: true, shipmentNo: true },
  });
  const sack = await prisma.sack.create({
    data: { sackNo: `TEST-SLG-SK-${ts}`, customerId: customer.id, shipmentId: shipment.id, seq: 1, weightKg: 50 },
    select: { id: true },
  });
  const mkRoll = (n: number, qty: number) =>
    prisma.roll.create({
      data: {
        barcode: `TEST-SLG-R${n}-${ts}`,
        itemId: item.id,
        colorId: color.id,
        status: "SHIPPED",
        currentQty: qty,
        initialQty: qty,
        width: 330,
        qualityGrade: "A",
        entrySource: "SUPPLIER_RECEIPT",
        shipmentId: shipment.id,
        sackId: sack.id,
      },
      select: { id: true },
    });
  // Saha vakasının metrajları (SVK2007260001): 49 + 452 = 501.
  const rSmall = await mkRoll(1, 49);
  const rBig = await mkRoll(2, 452);

  // Listeyi yalnız bu müşteriye daralt — dev/CI DB'sindeki diğer sevkler karışmasın.
  const listRow = async (extra: Record<string, string> = {}): Promise<ListRow> => {
    const res = (await shippingService.listShipments(
      fakeReq({ customerId: customer.id, ...extra }),
    )) as unknown as ListResult;
    const row = res.data.find((r) => r.shipmentNo === shipment.shipmentNo);
    if (!row) throw new Error("Test sevkiyatı listede bulunamadı");
    return row;
  };

  let returnId: string | null = null;

  try {
    // Gerçek `dispatchShipment` tx'inin yaptığı şey: içerik SEVK ANINDA donar.
    // Fixture sevkiyatı doğrudan DISPATCHED yarattığı için freeze elle çağrılır —
    // [3] adımındaki "liste = donmuş belge" karşılaştırması buna dayanır.
    await prisma.$transaction(async (tx) => {
      await printedDocumentService.freezeForSource(
        tx,
        PrintedDocType.SHIPMENT_DISPATCH,
        shipment.id,
        user.id,
      );
    });

    // ---------------------------------------------------------------------
    console.log("\n[1] İade YOKKEN liste = gerçek içerik");
    const before = await listRow();
    check("metraj 501 m", before.totalMeters === 501, `${before.totalMeters}`);
    check("top adedi 2", before._count.rolls === 2, `${before._count.rolls}`);
    check("çuval kg 50", before.totalKg === 50, `${before.totalKg}`);
    check("iade sayacı 0", before._count.returns === 0, `${before._count.returns}`);

    // ---------------------------------------------------------------------
    console.log("\n[2] 49 m iade alınır — CANLI düşer, LİSTE BRÜT kalır");
    const created = (await returnService.createReturn(
      { rollId: rSmall.id, reasonText: "TEST — liste brüt sınaması" },
      user.id,
    )).data as { id: string };
    returnId = created.id;

    // Ön koşul: canlı taraf gerçekten değişmiş olmalı, yoksa test hiçbir şey ölçmez.
    const liveRolls = await prisma.roll.count({ where: { shipmentId: shipment.id } });
    const liveMeters = await prisma.roll.aggregate({
      where: { shipmentId: shipment.id },
      _sum: { currentQty: true },
    });
    check("ön koşul — canlı top 1'e düştü", liveRolls === 1, `${liveRolls}`);
    check("ön koşul — canlı metraj 452", Number(liveMeters._sum.currentQty) === 452, `${liveMeters._sum.currentQty}`);

    const after = await listRow();
    check("REGRESYON: liste metrajı hâlâ 501 (brüt)", after.totalMeters === 501, `${after.totalMeters}`);
    check("REGRESYON: liste top adedi hâlâ 2 (brüt)", after._count.rolls === 2, `${after._count.rolls}`);
    // Geri-ekleme gerçekten koştu mu? Canlıdan FARKLI olması bunun kanıtı.
    check("brüt ≠ canlı (geri-ekleme fiilen çalıştı)", after.totalMeters !== Number(liveMeters._sum.currentQty));
    check("brüt adet ≠ canlı adet", after._count.rolls !== liveRolls);
    check("iade bilgisi kaybolmadı (_count.returns = 1)", after._count.returns === 1, `${after._count.returns}`);
    check("kg değişmedi (iade tartıya dokunmaz)", after.totalKg === 50, `${after.totalKg}`);

    // ---------------------------------------------------------------------
    console.log("\n[3] Fiş ile liste AYNI rakamı söylüyor");
    const report = (await shippingService.getDispatchReport(shipment.id)).data as {
      totals: { totalMeters: number; totalRolls: number };
    };
    check(
      "liste metrajı = fiş metrajı",
      after.totalMeters === report.totals.totalMeters,
      `${after.totalMeters} / ${report.totals.totalMeters}`,
    );
    check(
      "liste top adedi = fiş top adedi",
      after._count.rolls === report.totals.totalRolls,
      `${after._count.rolls} / ${report.totals.totalRolls}`,
    );

    // ---------------------------------------------------------------------
    console.log("\n[4] Dönem özeti (withSummary) de brüt");
    const sumRes = (await shippingService.listShipments(
      fakeReq({ customerId: customer.id, mode: "cursor", limit: "50", withSummary: "true" }),
    )) as unknown as ListResult;
    check("summary alanı geldi", sumRes.summary != null);
    check("özet metrajı 501 (brüt)", sumRes.summary?.totalMeters === 501, `${sumRes.summary?.totalMeters}`);
    check("özet kg 50", sumRes.summary?.totalKg === 50, `${sumRes.summary?.totalKg}`);
    check("özet sevk adedi 1", sumRes.summary?.shipmentCount === 1, `${sumRes.summary?.shipmentCount}`);

    // Bayrak yoksa özet HİÇ gelmemeli (operasyon ekranı aggregate maliyeti ödemesin).
    const noSum = (await shippingService.listShipments(
      fakeReq({ customerId: customer.id, mode: "cursor", limit: "50" }),
    )) as unknown as ListResult;
    check("bayraksız istekte özet YOK", noSum.summary === undefined);

    // ---------------------------------------------------------------------
    console.log("\n[5] İade İPTAL edilince geri-ekleme de düşer (çift sayım yok)");
    await returnService.cancelReturn(returnId, "TEST — yanlış okutma", user.id);
    const afterCancel = await listRow();
    check("iptal sonrası metraj yine 501", afterCancel.totalMeters === 501, `${afterCancel.totalMeters}`);
    check("iptal sonrası top adedi yine 2", afterCancel._count.rolls === 2, `${afterCancel._count.rolls}`);
    check("iptal edilen iade sayılmıyor", afterCancel._count.returns === 0, `${afterCancel._count.returns}`);
    const liveAfterCancel = await prisma.roll.count({ where: { shipmentId: shipment.id } });
    check("ön koşul — iptal topu sevkiyata geri koydu", liveAfterCancel === 2, `${liveAfterCancel}`);
  } finally {
    if (returnId) {
      await prisma.printedDocument.deleteMany({ where: { sourceId: returnId } });
      await prisma.rollReturn.deleteMany({ where: { id: returnId } });
    }
    await prisma.printedDocument.deleteMany({ where: { sourceId: shipment.id } });
    await prisma.roll.deleteMany({ where: { id: { in: [rSmall.id, rBig.id] } } });
    await prisma.sack.deleteMany({ where: { shipmentId: shipment.id } });
    await prisma.shipment.delete({ where: { id: shipment.id } }).catch(() => {});
    await prisma.color.delete({ where: { id: color.id } }).catch(() => {});
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

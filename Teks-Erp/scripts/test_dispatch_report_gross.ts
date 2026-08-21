// =============================================================================
// Test: Muhasebe sevk fişi BRÜT'tür (sevk anı) — iade onu geriye dönük değiştirmez
// Çalıştır: npx tsx scripts/test_dispatch_report_gross.ts
//
// Sahadaki bulgu (SVK2007260001, 20.07.2026): sevkten 6 dakika sonra 49 m'lik bir
// top iade alındı. PDF (donmuş belge) 2 top / 501 m derken liste ve muhasebe Excel'i
// 1 top / 452 m diyordu — çünkü fiş CANLI çuval içeriğinden besleniyordu ve iade
// topun `sackId`'sini boşaltıyor. Aynı sevk fişi geçen ay 501, bugün 452 basıyordu.
//
// Bu test dört sözleşmeyi kilitler:
//   1) `getDispatchReport` donmuş snapshot'tan okur → iade sonrası rakam DEĞİŞMEZ.
//   2) Fişe iade özeti (`returns`) düşer — düşülmez, yalnız dipnot için bildirilir.
//   3) Toplu muhasebe export'unda sevk satırları BRÜT'tür (iade geri eklenir) →
//      ayrı "İade" bölümüyle birlikte "sevk − iade" TEK kez düşer (çift düşme yok).
//   4) İade irsaliyesi iade ANINDA donar; iade iptalinde VOIDED'e çekilir.
// =============================================================================
import { PrintedDocType, PrintedDocStatus } from "@prisma/client";
import type { Request } from "express";
import prisma from "../src/lib/prisma";
import { printedDocumentService } from "../src/services/printed-document.service";
import { shippingService } from "../src/services/shipping.service";
import { returnService } from "../src/services/return.service";
import { buildDispatchAccountingExport } from "../src/services/accounting-export.service";

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

interface DispatchReportShape {
  products: Array<{ name: string; rollCount: number; totalMeters: number }>;
  totals: { totalRolls: number; totalMeters: number; totalKg: number; sackCount: number };
  frozen: boolean;
  docStatus: string | null;
  returns: { count: number; meters: number };
}

interface AccountingShape {
  shipments: Array<{ shipmentNo: string; rollCount: number; totalMeters: number; totalKg: number }>;
  byProduct: Array<{ itemName: string; rollCount: number; totalMeters: number }>;
  returns: Array<{ fromShipmentNo: string; meters: number }>;
  totals: { rollCount: number; totalMeters: number; returnMeters: number };
}

/** Donmuş sevk irsaliyesi payload'ının test için gereken kısmı. */
interface ShipmentDocShape {
  sacks: Array<{ code: string; totalMeters: number; totalKg: number; packageCount: number }>;
  cekiRows: Array<{ rollId: string; meters: number }>;
  totals: { totalRolls: number; totalMeters: number; totalKg: number; sackCount: number };
}

/** parseQueryParams yalnız `req.query` okur — sahte Request yeterli. */
const fakeReq = (query: Record<string, string>) => ({ query }) as unknown as Request;

async function main() {
  const ts = Date.now();
  // Fixture'ı test kendi yaratır (dev DB'sindeki veriye BAĞIMLI OLMA kuralı) —
  // yalnız `admin` seed kullanıcısı business-key ile çözülür.
  const user = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!user) throw new Error("Seed kullanıcısı 'admin' yok — önce `npm run seed`.");

  const customer = await prisma.customer.create({
    data: { code: `TST-DRG-${ts}`, name: `TEST DRG MÜŞTERİ ${ts}`, taxNumber: "1112223334" },
    select: { id: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-DRG-I-${ts}`, name: `DRG KUMAŞ ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true, name: true },
  });
  const color = await prisma.color.create({
    data: { code: `TST-DRG-C-${ts}`, name: "EKRU" },
    select: { id: true },
  });
  const shipment = await prisma.shipment.create({
    data: {
      shipmentNo: `TEST-DRG-${ts}`,
      customerId: customer.id,
      status: "DISPATCHED",
      destination: "DOMESTIC",
      dispatchedAt: new Date(),
    },
    select: { id: true, shipmentNo: true },
  });
  const sack = await prisma.sack.create({
    data: {
      sackNo: `TEST-DRG-SK-${ts}`,
      customerId: customer.id,
      shipmentId: shipment.id,
      seq: 1,
      weightKg: 50,
    },
    select: { id: true },
  });
  const mkRoll = (n: number, qty: number) =>
    prisma.roll.create({
      data: {
        barcode: `TEST-DRG-R${n}-${ts}`,
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
  // Saha vakasının birebir metrajları: 49 + 452 = 501.
  const rSmall = await mkRoll(1, 49);
  const rBig = await mkRoll(2, 452);

  let returnId: string | null = null;

  try {
    // ---------------------------------------------------------------------
    console.log("\n[1] Sevk anında belge donar — fiş brüt 501 m");
    // Gerçek dispatch tx'inin yaptığı şey: içerik donar.
    await prisma.$transaction(async (tx) => {
      await printedDocumentService.freezeForSource(
        tx,
        PrintedDocType.SHIPMENT_DISPATCH,
        shipment.id,
        user.id,
      );
    });

    const before = (await shippingService.getDispatchReport(shipment.id)).data as DispatchReportShape;
    check("fiş donmuş belgeden geliyor", before.frozen === true);
    check("brüt toplam 501 m", before.totals.totalMeters === 501, `${before.totals.totalMeters}`);
    check("brüt top adedi 2", before.totals.totalRolls === 2, `${before.totals.totalRolls}`);
    check("çuval kg 50", before.totals.totalKg === 50, `${before.totals.totalKg}`);
    check("henüz iade yok", before.returns.count === 0 && before.returns.meters === 0);

    // ---------------------------------------------------------------------
    console.log("\n[2] 49 m iade alınır — CANLI durum değişir, FİŞ DEĞİŞMEZ");
    const created = (await returnService.createReturn(
      { rollId: rSmall.id, reasonText: "TEST — kumaş hatası" },
      user.id,
    )).data as { id: string };
    returnId = created.id;

    // Canlı taraf gerçekten değişti mi? (testin anlamlı olması bu ön koşula bağlı)
    const liveRolls = await prisma.roll.count({ where: { sackId: sack.id } });
    check("canlı: çuvalda 1 top kaldı", liveRolls === 1, `${liveRolls}`);

    const after = (await shippingService.getDispatchReport(shipment.id)).data as DispatchReportShape;
    check(
      "REGRESYON: fiş hâlâ 501 m (iade geriye dönük düşmedi)",
      after.totals.totalMeters === 501,
      `${after.totals.totalMeters}`,
    );
    check("REGRESYON: fiş hâlâ 2 top", after.totals.totalRolls === 2, `${after.totals.totalRolls}`);
    check("fiş iade özetini bildiriyor (1 top)", after.returns.count === 1, `${after.returns.count}`);
    check("fiş iade metrajını bildiriyor (49 m)", after.returns.meters === 49, `${after.returns.meters}`);

    // ---------------------------------------------------------------------
    // 2026-08-05'e kadar AÇIK KALAN DELİK. Yukarıdaki [2] yalnız `getDispatchReport`'u
    // (donmuş snapshot okur) korumuştu. Ama BELGE ÜRETİCİSİ (`collectShipmentDocContent`)
    // canlı okumaya devam ediyordu ve onu iki yol sevkten SONRA çağırır:
    //   • reissue    — gerekçeli revizyon
    //   • lazy-init  — donmuş belgesi olmayan eski kayıt ilk kez açıldığında
    // Yani iadeden sonra üretilen "donmuş" resmi belge NET (452) doğuyordu: ekran
    // düzelmişti, BELGE YOLU düzelmemişti. Sektör standardı: çıkış belgesi asla
    // düzeltilmez, iade ayrı belgeyle kapanır.
    console.log("\n[2b] REISSUE / LAZY-INIT de BRÜT üretmeli (belge yolu)");
    const reissued = await printedDocumentService.reissue(
      PrintedDocType.SHIPMENT_DISPATCH,
      shipment.id,
      "TEST — belge yolu brüt mü",
      user.id,
    );
    const reDoc = (reissued as { data?: { snapshot?: { doc?: ShipmentDocShape } } }).data;
    const reContent = reDoc?.snapshot?.doc;
    check("reissue belge üretti", reContent != null);
    check(
      "REGRESYON: yeni versiyon BRÜT 501 m (net 452 DEĞİL)",
      reContent?.totals.totalMeters === 501,
      `${reContent?.totals.totalMeters}`,
    );
    check(
      "REGRESYON: yeni versiyon BRÜT 2 top",
      reContent?.totals.totalRolls === 2,
      `${reContent?.totals.totalRolls}`,
    );
    check(
      "çeki listesi 2 satır (iade edilen top da irsaliyede)",
      reContent?.cekiRows.length === 2,
      `${reContent?.cekiRows.length}`,
    );
    check(
      "çuval metrajı da brüt (501)",
      reContent?.sacks[0]?.totalMeters === 501,
      `${reContent?.sacks[0]?.totalMeters}`,
    );
    check(
      "çuval top adedi brüt (2)",
      reContent?.sacks[0]?.packageCount === 2,
      `${reContent?.sacks[0]?.packageCount}`,
    );
    // kg iadeden ETKİLENMEZ (`Sack.weightKg`'a dokunulmaz) → geri-ekleme çift saymamalı.
    check("kg ÇİFT SAYILMADI (50)", reContent?.totals.totalKg === 50, `${reContent?.totals.totalKg}`);
    // Aynı topun hem canlı hem iade satırı olarak gelmesi (yarış) → dedup.
    const rollIds = (reContent?.cekiRows ?? []).map((c) => c.rollId);
    check("çeki satırlarında mükerrer top YOK", new Set(rollIds).size === rollIds.length);
    // Fiş de aynı rakamı söylemeli — revizyon sonrası ekran/belge ayrışmasın.
    const afterReissue = (await shippingService.getDispatchReport(shipment.id)).data as DispatchReportShape;
    check(
      "fiş revizyon sonrası da 501 m",
      afterReissue.totals.totalMeters === 501,
      `${afterReissue.totals.totalMeters}`,
    );

    // ---------------------------------------------------------------------
    console.log("\n[3] İade irsaliyesi iade ANINDA dondu");
    const retDoc = await prisma.printedDocument.findFirst({
      where: { docType: PrintedDocType.RETURN_DISPATCH, sourceId: returnId },
      select: { status: true, version: true, reconstructed: true, documentNo: true },
    });
    check("RETURN_DISPATCH belgesi var", retDoc != null, retDoc?.documentNo ?? "yok");
    check("v1 + ACTIVE", retDoc?.version === 1 && retDoc?.status === PrintedDocStatus.ACTIVE);
    check(
      "lazy-init değil, gerçek freeze (reconstructed=false)",
      retDoc?.reconstructed === false,
    );

    // ---------------------------------------------------------------------
    console.log("\n[4] Toplu muhasebe export'u BRÜT — çift düşme yok");
    const exp = (await buildDispatchAccountingExport(fakeReq({ ids: shipment.id }))).data as AccountingShape;
    const row = exp.shipments.find((s) => s.shipmentNo === shipment.shipmentNo);
    check("sevkiyat satırı export'ta var", row != null);
    check("sevk satırı BRÜT 501 m (net 452 DEĞİL)", row?.totalMeters === 501, `${row?.totalMeters}`);
    check("sevk satırı BRÜT 2 top", row?.rollCount === 2, `${row?.rollCount}`);
    check("icmal·kumaş da brüt (2 top / 501 m)", exp.byProduct.some((p) => p.rollCount === 2 && p.totalMeters === 501));
    check("iade ayrı bölümde listeleniyor", exp.returns.some((r) => r.meters === 49));
    check("iade toplamı 49 m", exp.totals.returnMeters === 49, `${exp.totals.returnMeters}`);
    // Asıl korunan invariant: net hesabı TEK kez düşmeli.
    check(
      "net = sevk − iade = 452 (tek düşüm)",
      exp.totals.totalMeters - exp.totals.returnMeters === 452,
      `${exp.totals.totalMeters} − ${exp.totals.returnMeters}`,
    );

    // ---------------------------------------------------------------------
    console.log("\n[5] İade iptali — belge VOIDED, fiş yine değişmez");
    await returnService.cancelReturn(returnId, "TEST — yanlış okutma", user.id);
    const voided = await prisma.printedDocument.findFirst({
      where: { docType: PrintedDocType.RETURN_DISPATCH, sourceId: returnId },
      select: { status: true },
    });
    check("iade belgesi VOIDED", voided?.status === PrintedDocStatus.VOIDED, `${voided?.status}`);

    const afterCancel = (await shippingService.getDispatchReport(shipment.id)).data as DispatchReportShape;
    check("iptal sonrası fiş yine 501 m", afterCancel.totals.totalMeters === 501, `${afterCancel.totals.totalMeters}`);
    check("iptal edilen iade sayılmıyor", afterCancel.returns.count === 0, `${afterCancel.returns.count}`);

    const expAfter = (await buildDispatchAccountingExport(fakeReq({ ids: shipment.id }))).data as AccountingShape;
    const rowAfter = expAfter.shipments.find((s) => s.shipmentNo === shipment.shipmentNo);
    check(
      "iptal sonrası export yine 501 m (çift sayım yok)",
      rowAfter?.totalMeters === 501,
      `${rowAfter?.totalMeters}`,
    );
    check("iptal sonrası iade toplamı 0", expAfter.totals.returnMeters === 0, `${expAfter.totals.returnMeters}`);
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

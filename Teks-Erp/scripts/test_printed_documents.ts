// =============================================================================
// PrintedDocument (resmi belge defteri) uçtan uca test
// Çalıştırma:  npx ts-node scripts/test_printed_documents.ts
// =============================================================================
// Doğrular:
//   1) Sevk olayı → v1 ACTIVE freeze (içerik + config + künye donmuş)
//   2) Kaynak sonradan değişse de snapshot SABİT (yasal kayıt)
//   3) Reissue → v1 SUPERSEDED + v2 ACTIVE (gerekçeli, eskisi saklı)
//   4) YENİ sevk = YENİ sourceId = yepyeni belge (öncekine dokunulmaz)
//   5) İptal → ACTIVE belge VOIDED (silinmez)
//   6) Shipment: DISPATCHED öncesi TASLAK (getCurrent=null), sonrası freeze
//      + irsaliye satır metrajı = sevk edilen metraj (alloc geri-indirgeme doğru)
// Kendi test verisini yaratır ve sonunda temizler (rollback yerine explicit delete).

import prisma, { pool } from "../src/lib/prisma";
import { PrintedDocType, PrintedDocStatus } from "@prisma/client";
import { kartelaService } from "../src/services/kartela.service";
import { shippingService } from "../src/services/shipping.service";
import { printedDocumentService } from "../src/services/printed-document.service";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, extra ?? "");
  }
}

/**
 * ⚠️ DAMGA `TEST-` ÖN EKLİ OLMAK ZORUNDA: `clean_test_residue.ts` artığı yalnız
 * `TEST-`/`TST-` deseninden tanır. Eski damga (`PDTEST`) o desene UYMUYORDU —
 * bekçi çöktüğünde (aşağıdaki anahtar çakışması tam bunu yaptı) bıraktığı satır
 * hiçbir temizlik yolundan görünmüyordu. Damga yalnız bu dosyada geçiyor ve
 * bekçinin kendi temizliği ID tabanlı, yani yeniden adlandırma davranışı
 * değiştirmez; kazandığı şey artığın GÖRÜNÜR olması.
 */
const TAG = "TEST-PD";
/**
 * Çakışmasız fixture anahtarı — ZAMANA DEĞİL SÜREÇ+SAYAÇA dayanır.
 *
 * ÖNCE: `${TAG}-${s}-${Math.floor(performance.now())}` — milisaniye
 * çözünürlüklü. Ölçüldü (2026-09-12 tam paket koşumu): iki `mkRoll` AYNI
 * milisaniyede koştu, aynı barkodu üretti ve bekçi 21/21 yeşil bastıktan SONRA
 * `Unique constraint failed on the fields: (barcode)` ile çöktü. Koşucu bunu
 * kırmızı gösterdi ama sebep regresyon değil kendi anahtarıydı — "kırmızı ≠
 * regresyon" sınıfı, "yeşil ≠ kapsandı"nın kardeşi.
 *
 * ŞİMDİ: `pid` süreçler arasında, sayaç süreç İÇİNDE tekilliği garanti eder;
 * zaman hiç kullanılmaz, yani hızlı makinede de çakışmaz.
 */
let sayac = 0;
const u = (s: string): string => `${TAG}-${s}-${process.pid}-${++sayac}`;

async function main(): Promise<void> {
  const created = { rolls: [] as string[], dispatchIds: [] as string[], shipmentIds: [] as string[], sackIds: [] as string[] };
  // F263: master-data tutucuları try DIŞINDA — cleanup finally'de guard'lı çalışsın
  // (gövde ortasında hata olursa TEST- verisi sızmasın; kardeş test kalıbı).
  let item: { id: string } | undefined;
  let color: { id: string } | undefined;
  let sub: { id: string } | undefined;
  let customer: { id: string } | undefined;
  let order: { id: string } | undefined;
  // Sevk onayı varsayılan KAPALI → createShipment doğrudan DISPATCHED eder. Bu test
  // "dispatch öncesi belge YOK (TASLAK) → dispatch → freeze" akışını doğruladığından
  // sevkiyat PLANNED kalmalı; onay geçici AÇILIR (finally'de geri alınır). Emsal:
  // test_roll_relabel_context.ts (5b).
  const CONF_KEY = "shipping.confirmationEnabled";
  let prevConf: { value: unknown } | null | undefined;
  try {
  // --- Ortak master data ---
  // Adlar da benzersiz: customers/items/subcontractors'ta nameFold DB seddi var
  // (2026-08-21) — yarıda kesilen bir koşumun artığı sabit adla ikinci koşumu P2002'ye düşürürdü.
  item = await prisma.item.create({
    data: { code: u("ITM"), name: `Test Kumaş ${u("N")}`, itemType: "FABRIC" },
  });
  color = await prisma.color.create({ data: { code: u("CLR"), name: `Test Renk ${u("N")}`, hex: "#abcdef" } });
  sub = await prisma.subcontractor.create({ data: { code: u("SUB"), name: `Test Kartela Fason ${u("N")}` } });

  const mkRoll = async (qty: number): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        barcode: u("RL"),
        itemId: item!.id,
        colorId: color!.id,
        initialQty: qty,
        currentQty: qty,
        qualityGrade: "A",
        status: "WAREHOUSE",
        entrySource: "SUBCONTRACTOR_RETURN",
        width: 150,
      },
    });
    created.rolls.push(r.id);
    return r.id;
  };

  // =========================================================================
  console.log("\n[KARTELA] freeze / değişmezlik / reissue / yeni-belge / void");
  // =========================================================================
  const k1r1 = await mkRoll(60);
  const k1r2 = await mkRoll(40);
  const kd1 = await kartelaService.dispatch(
    { subcontractorId: sub.id, rollIds: [k1r1, k1r2], plateNumber: "34 AAA 11", driverName: "Sürücü A" },
    undefined,
  );
  const kd1Id = (kd1.data as { id: string }).id;
  created.dispatchIds.push(kd1Id);

  // 1) v1 ACTIVE freeze
  const cur1 = (await printedDocumentService.getCurrent(PrintedDocType.KARTELA_DISPATCH, kd1Id)).data as any;
  check("kartela v1 oluştu", cur1 != null && cur1.version === 1 && cur1.status === "ACTIVE", cur1);
  // F263: documentNo == kartela dispatchNo (snapshot'tan). Eski `startsWith("KD-")`
  // bayattı — dispatchNo artık ayraçsız (KD2607000001), tireli değil.
  check(
    "v1 documentNo = dispatchNo",
    !!cur1?.documentNo && cur1.documentNo === cur1?.snapshot?.doc?.dispatchNo,
    cur1?.documentNo,
  );
  check("v1 snapshot.doc 2 top içeriyor", cur1?.snapshot?.doc?.rolls?.length === 2);
  check("v1 snapshot company donmuş", typeof cur1?.snapshot?.company?.name === "string");
  check("v1 snapshot frozenAt var", typeof cur1?.snapshot?.frozenAt === "string");
  const v1Json = JSON.stringify(cur1.snapshot);

  // 1b) Tek-kaynak HTML — GERÇEK builder snapshot'ı → renderKartelaCekiHtml
  // (kartela getHtml gerçek-builder kontratı; sample/unit fixture'ı değil).
  const kHtml = (await printedDocumentService.getHtml(PrintedDocType.KARTELA_DISPATCH, kd1Id))
    .data as { html: string } | null;
  check("kartela getHtml HTML üretti", (kHtml?.html.length ?? 0) > 500, `len=${kHtml?.html.length ?? 0}`);
  check("kartela getHtml başlık", !!kHtml && kHtml.html.includes("KARTELA ÇEKİ LİSTESİ"));
  check("kartela getHtml sevk no (snapshot)", !!kHtml && kHtml.html.includes(cur1.snapshot.doc.dispatchNo));
  check("kartela getHtml 2 top satırı (gerçek snapshot)", !!kHtml && kHtml.html.includes("Gönderilen Toplar (2)"));

  // 2) Kaynağı değiştir → snapshot SABİT kalmalı
  await prisma.kartelaDispatch.update({ where: { id: kd1Id }, data: { plateNumber: "99 ZZZ 99" } });
  const cur1b = (await printedDocumentService.getCurrent(PrintedDocType.KARTELA_DISPATCH, kd1Id)).data as any;
  check("kaynak değişti ama snapshot SABİT", JSON.stringify(cur1b.snapshot) === v1Json);

  // 3) Reissue → v2 ACTIVE, v1 SUPERSEDED, gerekçe
  const re = await printedDocumentService.reissue(
    PrintedDocType.KARTELA_DISPATCH,
    kd1Id,
    "plaka düzeltildi",
    undefined,
  );
  const v2 = re.data as any;
  check("reissue → v2 ACTIVE", v2.version === 2 && v2.status === "ACTIVE");
  check("v2 reissueReason kaydedildi", v2.reissueReason === "plaka düzeltildi");
  check("v2 güncel plakayı dondurdu", v2.snapshot.doc.plateNumber === "99 ZZZ 99", v2.snapshot.doc.plateNumber);
  const versions = (await printedDocumentService.listVersions(PrintedDocType.KARTELA_DISPATCH, kd1Id)).data as any[];
  check("2 versiyon var", versions.length === 2);
  check("v1 artık SUPERSEDED", versions.find((x) => x.version === 1)?.status === "SUPERSEDED");
  // v2 sonrası kaynağı yine değiştir → v2 snapshot sabit
  const v2Json = JSON.stringify(v2.snapshot);
  await prisma.kartelaDispatch.update({ where: { id: kd1Id }, data: { driverName: "Başka Sürücü" } });
  const v2b = (await printedDocumentService.getCurrent(PrintedDocType.KARTELA_DISPATCH, kd1Id)).data as any;
  check("v2 snapshot reissue sonrası da SABİT", JSON.stringify(v2b.snapshot) === v2Json);

  // 4) YENİ sevk = YENİ belge zinciri (öncekine dokunma)
  const k2r1 = await mkRoll(25);
  const kd2 = await kartelaService.dispatch({ subcontractorId: sub.id, rollIds: [k2r1] }, undefined);
  const kd2Id = (kd2.data as { id: string }).id;
  created.dispatchIds.push(kd2Id);
  const cur2 = (await printedDocumentService.getCurrent(PrintedDocType.KARTELA_DISPATCH, kd2Id)).data as any;
  check("yeni sevk → ayrı belge v1", cur2.version === 1 && cur2.snapshot.doc.rolls.length === 1);
  check("yeni sevk eski belgeyi etkilemedi", cur2.sourceId !== kd1Id);
  const firstStill = (await printedDocumentService.listVersions(PrintedDocType.KARTELA_DISPATCH, kd1Id)).data as any[];
  check("ilk belge hâlâ 2 versiyon", firstStill.length === 2);

  // 5) İptal → ACTIVE belge VOIDED
  await kartelaService.cancelDispatch(kd1Id, "test iptal sebebi", undefined);
  const afterCancel = (await printedDocumentService.listVersions(PrintedDocType.KARTELA_DISPATCH, kd1Id)).data as any[];
  check("iptal → güncel belge VOIDED", afterCancel.find((x) => x.version === 2)?.status === "VOIDED");
  check("iptal SUPERSEDED'e dokunmadı", afterCancel.find((x) => x.version === 1)?.status === "SUPERSEDED");

  // =========================================================================
  console.log("\n[SHIPMENT] TASLAK → DISPATCHED freeze + satır metrajı doğruluğu");
  // =========================================================================
  customer = await prisma.customer.create({
    data: { code: u("CST"), name: `Test Müşteri ${u("N")}`, type: "CUSTOMER" },
  });
  order = await prisma.order.create({
    data: {
      orderNumber: u("ORD"),
      customerId: customer.id,
      status: "APPROVED",
      lines: { create: [{ itemId: item!.id, colorId: color!.id, quantity: 100, width: 150 }] },
    },
  });
  const sr1 = await mkRoll(60);
  const sr2 = await mkRoll(40);

  // Çuval depo: müşteriye çuval aç → iki topu okut → tart (depoda kalır, mühür YOK)
  // → depodan çuval + sipariş seçerek sevkiyat kur (PLANNED). İrsaliyedeki çuval kodu = sackNo.
  const sackId = ((await shippingService.openSack({ customerId: customer.id }, undefined)).data as { id: string }).id;
  created.sackIds.push(sackId);
  for (const rid of [sr1, sr2]) {
    const r = await prisma.roll.findUnique({ where: { id: rid }, select: { barcode: true } });
    await shippingService.scanIntoSack({ sackId, barcode: r!.barcode! }, undefined);
  }
  await shippingService.weighSack({ sackId, weightKg: 42.5 }, undefined);
  const sackNo = (await prisma.sack.findUnique({ where: { id: sackId }, select: { sackNo: true } }))!.sackNo;
  // Onayı geçici AÇ → createShipment PLANNED bırakır (aksi hâlde auto-DISPATCHED olurdu).
  prevConf = await prisma.systemSetting.findUnique({ where: { key: CONF_KEY }, select: { value: true } });
  await prisma.systemSetting.upsert({ where: { key: CONF_KEY }, create: { key: CONF_KEY, value: true }, update: { value: true } });
  const ship = await shippingService.createShipment({ sackIds: [sackId], customerId: customer.id, orderIds: [order.id] }, undefined);
  const shipmentId = (ship.data as { id: string }).id;
  created.shipmentIds.push(shipmentId);

  // 6a) DISPATCHED öncesi TASLAK (belge yok — freeze yalnız dispatch'te)
  const draft = (await printedDocumentService.getCurrent(PrintedDocType.SHIPMENT_DISPATCH, shipmentId)).data;
  check("sevk öncesi belge yok (TASLAK)", draft === null, draft);

  await shippingService.dispatchShipment(shipmentId, { plateNumber: "06 BBB 22", driverName: "Şoför S" }, undefined);

  // 6b) DISPATCHED sonrası freeze
  const sdoc = (await printedDocumentService.getCurrent(PrintedDocType.SHIPMENT_DISPATCH, shipmentId)).data as any;
  check("sevk sonrası v1 ACTIVE freeze", sdoc != null && sdoc.version === 1 && sdoc.status === "ACTIVE", sdoc?.status);
  // TEK KAYNAK: donmuş irsaliye = muhasebe fişi (ornek-fis 3 bölüm: ürün/çuval/çeki)
  const doc = sdoc?.snapshot?.doc;
  check("irsaliye ürün listesi (1 grup, 2 top, 100m)",
    doc?.products?.length === 1 && doc?.products?.[0]?.rollCount === 2 && Math.round(doc?.products?.[0]?.totalMeters) === 100,
    JSON.stringify(doc?.products));
  check("toplam metraj 100", Math.round(doc?.totals?.totalMeters) === 100, JSON.stringify(doc?.totals));
  check("çuval dökümü donmuş (kod=sackNo, 42.5kg, 2 paket)",
    doc?.sacks?.length === 1 && doc?.sacks?.[0]?.code === sackNo && Math.abs(doc?.sacks?.[0]?.totalKg - 42.5) < 0.001 && doc?.sacks?.[0]?.packageCount === 2,
    JSON.stringify(doc?.sacks));
  check("çeki listesi: kg yalnız çuvalın ilk topunda",
    doc?.cekiRows?.length === 2 && Math.abs(doc?.cekiRows?.[0]?.kg - 42.5) < 0.001 && doc?.cekiRows?.[1]?.kg === 0);
  check("plaka header'da donmuş", doc?.header?.plateNumber === "06 BBB 22", doc?.header?.plateNumber);

  // Muhasebe fişi (getDispatchReport) ile donmuş irsaliye içeriği BİREBİR (tek kaynak)
  const report = (await shippingService.getDispatchReport(shipmentId)).data as any;
  check("fiş == irsaliye (tek kaynak: top/metre/çuval/çeki)",
    report?.totals?.totalRolls === doc?.totals?.totalRolls &&
      report?.totals?.totalMeters === doc?.totals?.totalMeters &&
      report?.products?.length === doc?.products?.length &&
      report?.cekiRows?.length === doc?.cekiRows?.length &&
      report?.header?.shipmentNo === doc?.header?.shipmentNo);

  // Tek-kaynak baskı HTML'i üretiliyor (getHtml artık 400 vermiyor)
  const htmlRes = (await printedDocumentService.getHtml(PrintedDocType.SHIPMENT_DISPATCH, shipmentId)).data as { html: string } | null;
  check("getHtml SEVK İRSALİYESİ + ÇEKİ LİSTESİ üretti",
    !!htmlRes?.html && htmlRes.html.includes("SEVK İRSALİYESİ") && htmlRes.html.includes("ÇEKİ LİSTESİ"),
    htmlRes?.html?.slice(0, 30));

  } finally {
    // Sevk onayı ayarını eski değerine döndür (yukarıda geçici açılmıştı).
    if (prevConf !== undefined) {
      if (prevConf === null) await prisma.systemSetting.delete({ where: { key: CONF_KEY } }).catch(() => {});
      else await prisma.systemSetting.update({ where: { key: CONF_KEY }, data: { value: prevConf.value as never } }).catch(() => {});
    }
    // F263: cleanup HER ZAMAN çalışır (gövde ortasında hata olsa da) + deleteMany
    // + if-guard → partial-failure temizliği yeni hata fırlatmaz.
    await prisma.printedDocument.deleteMany({
      where: { sourceId: { in: [...created.dispatchIds, ...created.shipmentIds] } },
    });
    // Çuval havuzu: SackAllocation (Restrict) → roll↔çuval/sevkiyat bağını çöz → sack →
    // ShipmentOrder (Restrict) → shipment. (Eski ShipmentAllocation modeli kaldırıldı.)
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: created.sackIds } } });
    await prisma.roll.updateMany({ where: { id: { in: created.rolls } }, data: { shipmentId: null, sackId: null } });
    await prisma.sack.deleteMany({ where: { id: { in: created.sackIds } } });
    await prisma.kartelaDispatchItem.deleteMany({ where: { dispatchId: { in: created.dispatchIds } } });
    await prisma.kartelaDispatch.deleteMany({ where: { id: { in: created.dispatchIds } } });
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: created.shipmentIds } } });
    await prisma.shipment.deleteMany({ where: { id: { in: created.shipmentIds } } });
    if (order) {
      await prisma.orderLine.deleteMany({ where: { orderId: order.id } });
      await prisma.order.deleteMany({ where: { id: order.id } });
    }
    await prisma.roll.deleteMany({ where: { id: { in: created.rolls } } });
    if (sub) await prisma.subcontractor.deleteMany({ where: { id: sub.id } });
    if (color) await prisma.color.deleteMany({ where: { id: color.id } });
    if (item) await prisma.item.deleteMany({ where: { id: item.id } });
    if (customer) await prisma.customer.deleteMany({ where: { id: customer.id } });
    console.log(`\n=== ${pass}/${pass + fail} geçti ===`);
    await prisma.$disconnect();
    await pool.end(); // havuz kapanmazsa süreç 30s idle bekler
  }
  if (fail > 0) process.exit(1);
}

// ⚠️ ARALIKLI DÜŞÜŞ, ÇIKTISI YANILTICIYDI (2026-09-07): paket içinde iki kez
// düştü ve koşucu satırı "21/21 geçti" + ❌ gösterdi. Sebebi şu: gövde ortada
// FIRLATIYOR (kontrol başarısızlığı DEĞİL), `finally` o ana kadarki sayıyla
// özeti basıyor ve `fail` sıfır kalıyor. Yani ekrandaki cümle "her kontrol
// geçti" derken süreç hata koduyla ölüyordu.
//
// Sebep henüz bulunamadı (tek başına ve sonraki koşumlarda hep yeşil). O
// bulunana kadar en azından ÇIKTI DÜRÜST olsun: fırlatan hata özete girsin ve
// yığın izi görünsün — bir dahaki düşüşte teşhis için tekrar koşum gerekmesin.
main().catch((e) => {
  console.error("\n❌ TEST YARIDA KESİLDİ (kontrol hatası değil, FIRLATAN hata):");
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  console.error(
    "\n⚠️ Yukarıdaki özet satırı YANILTICI olabilir: yalnız kesilmeden ÖNCEKİ " +
      "kontrolleri sayar. Paket içinde düşüp tek başına geçiyorsa sıra/yarış " +
      "kaynaklı bir çakışma arayın.",
  );
  process.exit(1);
});

// =============================================================================
// Test: Sevk İrsaliyesi TEK KAYNAK belgesi (renderShipmentDispatchHtml + getHtml)
// Çalıştır: npx tsx scripts/test_shipment_dispatch_document.ts
//
// Bölüm 1 (saf fonksiyon, DB yok): renderShipmentDispatchHtml çıktısını doğrular —
//   yasal başlık (firma/SAYIN/vergi no/irsaliye no/tarih/yön/plaka) + 3 bölüm
//   (ÜRÜN/ÇUVAL/ÇEKİ) + toplam + imza + filigran (TASLAK/İPTAL/ESKİ KOPYA) + HTML
//   kaçışı (XSS) + bölüm aç/kapa + başlık override + TR sayı biçimi.
// Bölüm 2 (DB): PLANNED sevkiyatta getHtml ?draft → TASLAK; donmuş belge yokken
//   draft'sız → null (controller 409). İrsaliye yalnız DISPATCHED'te donar. Tek kaynak:
//   muhasebe fişi içeriği == belge.
// =============================================================================
import { PrintedDocType } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { printedDocumentService } from "../src/services/printed-document.service";
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";
import { renderShipmentDispatchHtml } from "../src/services/document-render/shipment-dispatch.html";
// SHIPMENT_DISPATCH builder kaydı modül yan etkisidir (sunucuda boot'ta yüklenir).
import "../src/services/shipping.service";

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

function makeSnapshot(): PrintedDocSnapshot {
  return {
    schemaVersion: 1,
    frozenAt: "2026-06-28T10:00:00.000Z",
    company: {
      name: "ACME <Tekstil> A.Ş.",
      letterhead: { addressLine: "Org. San. Böl.", phone: "0212 000", taxInfo: "İkitelli 1234567890" },
    },
    docConfigOverride: null,
    doc: {
      header: {
        shipmentNo: "SVK-1024",
        customerName: "MÜŞTERİ <A> A.Ş.",
        customerCode: "C-7",
        customerTaxNumber: "9876543210",
        branchName: "Merkez",
        procedureCode: "GB-2026-555",
        destination: "EXPORT",
        status: "DISPATCHED",
        date: "2026-06-28T09:30:00.000Z",
        plateNumber: "34 ABC 34",
        driverName: "Ali Veli",
        carrier: "Yurtiçi",
        orderNos: "ORD-1, ORD-2",
      },
      products: [
        { name: "MC 156 BEYAZ 150cm.", rollCount: 3, totalMeters: 105 },
        { name: "NEPS VUAL 40cm.", rollCount: 1, totalMeters: 1234.5 },
      ],
      sacks: [
        { code: "AMB00001", seq: 1, totalMeters: 70, totalKg: 65.8, packageCount: 2 },
        { code: "AMB00002", seq: 2, totalMeters: 75, totalKg: 40, packageCount: 2 },
      ],
      cekiRows: [
        { sackCode: "AMB00001", barcode: "BR-1", desen: "MC 156", varyant: "BEYAZ", meters: 35, kg: 65.8 },
        { sackCode: "AMB00001", barcode: "BR-2", desen: "MC 156", varyant: "BEYAZ", meters: 35, kg: 0 },
      ],
      totals: { totalRolls: 4, totalMeters: 1339.5, totalKg: 105.8, sackCount: 2 },
    },
  } as unknown as PrintedDocSnapshot;
}

function part1Pure() {
  console.log("\n[1] renderShipmentDispatchHtml — saf fonksiyon");
  const snap = makeSnapshot();
  const html = renderShipmentDispatchHtml(snap, {});

  check("başlık SEVK İRSALİYESİ", html.includes("SEVK İRSALİYESİ"));
  check("firma anteti", html.includes("ACME &lt;Tekstil&gt; A.Ş."));
  check("XSS: firma adı kaçışlı (ham < yok)", !html.includes("ACME <Tekstil>"));
  check("SAYIN müşteri kaçışlı", html.includes("MÜŞTERİ &lt;A&gt; A.Ş."));
  check("vergi no", html.includes("9876543210"));
  check("irsaliye no", html.includes("SVK-1024"));
  check("tarih TR biçim (28.06.2026)", html.includes("28.06.2026"));
  check("yön Yurtdışı (EXPORT)", html.includes("Yurtdışı"));
  check("gümrük/ihracat no", html.includes("GB-2026-555"));
  // K15 (2026-09-23): gümrük no yalnız YURTDIŞINDA basılır; yurtiçinde dolu değer de basılmaz, boşsa satır yok
  // (yedek değer uydurulmaz). Eski belgelere etki ölçüldü: fabrika kopyasında procedureCode dolu sevk 0.
  const yurtici = makeSnapshot();
  (yurtici.doc as { header: { destination: string } }).header.destination = "DOMESTIC";
  check("yurtiçi: gümrük no BASILMAZ (dolu olsa bile)", !renderShipmentDispatchHtml(yurtici, {}).includes("GB-2026-555"));
  const bos = makeSnapshot();
  (bos.doc as { header: { procedureCode: string | null } }).header.procedureCode = null;
  check("yurtdışı + boş: 'Gümrük/İhracat No' satırı yok, cari kodu yerine geçmez", !renderShipmentDispatchHtml(bos, {}).includes("Gümrük/İhracat No"));
  check("sipariş no'ları", html.includes("ORD-1, ORD-2"));
  check("plaka + şoför", html.includes("34 ABC 34") && html.includes("Ali Veli"));

  check("ÜRÜN LİSTESİ bölümü", html.includes("ÜRÜN LİSTESİ"));
  check("ÇUVAL LİSTESİ bölümü", html.includes("ÇUVAL LİSTESİ"));
  check("ÇEKİ LİSTESİ bölümü", html.includes("ÇEKİ LİSTESİ"));
  check("ürün satırı", html.includes("MC 156 BEYAZ 150cm."));
  check("çuval kodu", html.includes("AMB00001"));
  check("çeki barkodu", html.includes("BR-1"));

  // TR sayı biçimi: binlik "." ondalık "," — metre/kg 2 ondalık.
  check("TR sayı: 1.234,50 (metre)", html.includes("1.234,50"));
  check("TR sayı: 65,80 (kg)", html.includes("65,80"));
  check("TR sayı: toplam 1.339,50", html.includes("1.339,50"));

  // İmza + filigran varyasyonları
  check("imza kutuları (Teslim Eden/Alan)", html.includes("Teslim Eden") && html.includes("Teslim Alan"));
  check("official → filigran yok", !html.includes(">TASLAK<") && !html.includes(">İPTAL<"));
  check("draft → TASLAK filigranı", renderShipmentDispatchHtml(snap, { draft: true }).includes(">TASLAK<"));
  check("VOIDED → İPTAL filigranı", renderShipmentDispatchHtml(snap, { status: "VOIDED" }).includes(">İPTAL<"));
  check("SUPERSEDED → ESKİ KOPYA filigranı", renderShipmentDispatchHtml(snap, { status: "SUPERSEDED" }).includes(">ESKİ KOPYA<"));

  // Bölüm aç/kapa + başlık override (docConfigOverride)
  const cfgSnap = {
    ...snap,
    docConfigOverride: { titleOverride: "İRSALİYE/FATURA", sections: { ceki: false }, showSignatures: false },
  } as unknown as PrintedDocSnapshot;
  const cfgHtml = renderShipmentDispatchHtml(cfgSnap, {});
  check("başlık override uygulanıyor", cfgHtml.includes("İRSALİYE/FATURA"));
  check("ÇEKİ bölümü kapatıldı", !cfgHtml.includes("ÇEKİ LİSTESİ"));
  check("ÜRÜN bölümü hâlâ açık", cfgHtml.includes("ÜRÜN LİSTESİ"));
  check("imza kapatıldı", !cfgHtml.includes("Teslim Eden"));
}

// ── §3 KİMLİK ŞERİDİ (sections.listHeader, 2026-09-10) ──────────────────────
// Her liste kendi sayfasından başlıyor ama antet yalnız 1. sayfada; şerit 2. ve
// 3. sayfaya kimlik verir. OPT-IN — bugüne kadar donmuş belgeler değişmemeli.
function part3ListHeader() {
  console.log("\n[3] Kimlik şeridi — sections.listHeader (opt-in)");
  const snap = makeSnapshot();
  const withHeader = (cfg: Record<string, unknown>) =>
    renderShipmentDispatchHtml(
      { ...snap, docConfigOverride: cfg } as unknown as PrintedDocSnapshot,
      {},
    );
  /** Şerit hücresi sayısı — `<th class="ident l">` kaç tabloda basıldı. */
  const identCount = (html: string) => (html.match(/class="ident l"/g) ?? []).length;

  // 1) VARSAYILAN KAPALI — anahtar yokken tek bayt eklenmez.
  const base = renderShipmentDispatchHtml(snap, {});
  check("§3.1 anahtar yok → şerit BASILMAZ", identCount(base) === 0);
  check("§3.1 anahtar yok → 'Sevk Edilen Firma' geçmiyor", !base.includes("Sevk Edilen Firma"));

  // 2) `false` de kapalı, `true` olmadıkça açılmaz (blocklist'e DÜŞMEZ).
  check("§3.2 listHeader:false → kapalı", identCount(withHeader({ sections: { listHeader: false } })) === 0);

  // 3) AÇIK — üç liste basılıyorken şerit İKİ tabloda (ilk liste hariç).
  const on = withHeader({ sections: { listHeader: true } });
  check("§3.3 listHeader:true → şerit 2 tabloda (ilk liste hariç)", identCount(on) === 2);
  check("§3.3 şerit müşteri adını taşıyor (kaçışlı)", on.includes("MÜŞTERİ &lt;A&gt; A.Ş."));
  check("§3.3 şerit irsaliye no'yu taşıyor", on.includes("Sevk Edilen Firma") && on.includes("SVK-1024"));
  // ⚠️ EN ÖNEMLİ SONDA: şerit ÜRÜN listesinde YOK (1. sayfada antet zaten var),
  // ÇUVAL ve ÇEKİ'de VAR. Konum ölçüsü — düz `includes` bunu ayırt edemez.
  const iUrun = on.indexOf("ÜRÜN LİSTESİ");
  const iCuval = on.indexOf("ÇUVAL LİSTESİ");
  const iCeki = on.indexOf("ÇEKİ LİSTESİ");
  const firstIdent = on.indexOf('class="ident l"');
  check("§3.3 ilk şerit ÜRÜN listesinden SONRA (ürün tablosunda yok)", firstIdent > iCuval);
  check("§3.3 şerit ÇUVAL ve ÇEKİ arasında + sonrasında", iUrun < iCuval && iCuval < iCeki);

  // 4) Şerit `thead` İÇİNDE — taşan sayfada tekrar etmesinin TEK koşulu bu.
  const cuvalThead = on.slice(iCuval, on.indexOf("</thead>", iCuval));
  check("§3.4 şerit thead içinde (devam sayfasında tekrar eder)", cuvalThead.includes('class="ident l"'));

  // 5) MERGE — listeler tek sayfada akıyorsa hiçbiri antetten kopmaz → şerit yok.
  const merged = renderShipmentDispatchHtml(
    { ...snap, docConfigOverride: { sections: { listHeader: true } } } as unknown as PrintedDocSnapshot,
    { mergeSections: true },
  );
  check("§3.5 ?merge=1 → şerit BASILMAZ", identCount(merged) === 0);

  // 6) Tek liste basılıyorsa o liste İLK'tir → şerit yok (antet aynı sayfada).
  const onlyCeki = withHeader({ sections: { listHeader: true, urun: false, cuval: false } });
  check("§3.6 yalnız ÇEKİ basılıyor → şerit yok (ilk liste)", identCount(onlyCeki) === 0);

  // 7) Şerit alanları başlık toggle'larına saygılı (docNo/date kapalıysa girmez).
  const noDocNo = withHeader({ sections: { listHeader: true, docNo: false, date: false } });
  check("§3.7 docNo kapalı → şeritte irsaliye no yok", !noDocNo.includes("SVK-1024"));
  check("§3.7 docNo kapalı → şeritte firma adı DURUYOR", identCount(noDocNo) === 2);

  // 8) EN kapsamlı: şerit kolon başlığına BENZEMEZ (kendi CSS sınıfı var).
  check("§3.8 şerit için ayrı CSS kuralı basıldı", on.includes(".sec thead th.ident"));
}

async function part2Db() {
  console.log("\n[2] getHtml ?draft — PLANNED sevkiyat (DB)");
  const ts = Date.now();
  const customer = await prisma.customer.create({
    data: { code: `TST-SDD-${ts}`, name: `TEST SDD MÜŞTERİ ${ts}`, taxNumber: "1112223334" },
    select: { id: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-SDD-I-${ts}`, name: `SDD KUMAŞ ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const color = await prisma.color.create({
    data: { code: `TST-SDD-C-${ts}`, name: `LACİVERT ${ts}` },
    select: { id: true },
  });
  const shipment = await prisma.shipment.create({
    data: {
      shipmentNo: `TEST-SDD-${ts}`,
      customerId: customer.id,
      status: "PLANNED",
      destination: "DOMESTIC",
    },
    select: { id: true },
  });
  const sack = await prisma.sack.create({
    data: { sackNo: `TEST-SDD-SK-${ts}`, customerId: customer.id, shipmentId: shipment.id, seq: 1, weightKg: 50 },
    select: { id: true },
  });
  const mkRoll = (n: number, qty: number) =>
    prisma.roll.create({
      data: {
        barcode: `TEST-SDD-R${n}-${ts}`,
        itemId: item.id,
        colorId: color.id,
        status: "WAREHOUSE",
        currentQty: qty,
        initialQty: qty,
        width: 150,
        qualityGrade: "A",
        entrySource: "SUPPLIER_RECEIPT",
        shipmentId: shipment.id,
        sackId: sack.id,
      },
      select: { id: true },
    });
  const r1 = await mkRoll(1, 60);
  const r2 = await mkRoll(2, 40);

  try {
    // Donmuş belge yok → getCurrent null (TASLAK)
    const cur = (await printedDocumentService.getCurrent(PrintedDocType.SHIPMENT_DISPATCH, shipment.id)).data;
    check("PLANNED: donmuş belge yok (TASLAK)", cur === null);

    // draft'sız getHtml → data null (controller 409'a çevirir)
    const noDraft = (await printedDocumentService.getHtml(PrintedDocType.SHIPMENT_DISPATCH, shipment.id)).data;
    check("draft'sız getHtml → null (409)", noDraft === null);

    // allowDraft → canlı TASLAK önizleme (kaydedilmez)
    const draftRes = (
      await printedDocumentService.getHtml(PrintedDocType.SHIPMENT_DISPATCH, shipment.id, undefined, {
        allowDraft: true,
      })
    ).data as { html: string } | null;
    check("allowDraft → HTML üretti", !!draftRes?.html, draftRes?.html?.slice(0, 30));
    check("draft → TASLAK filigranı", !!draftRes?.html?.includes(">TASLAK<"));
    check("draft → 3 bölüm var", !!draftRes?.html?.includes("ÇEKİ LİSTESİ") && !!draftRes?.html?.includes("ÜRÜN LİSTESİ"));
    check("draft → çuval kodu (sackNo) + 100m toplam", !!draftRes?.html?.includes(`TEST-SDD-SK-${ts}`) && !!draftRes?.html?.includes("100,00"));

    // draft önizleme KAYDEDİLMEDİ (defterde satır yok)
    const persisted = await prisma.printedDocument.count({ where: { sourceId: shipment.id } });
    check("draft önizleme kaydedilmedi", persisted === 0, `${persisted} satır`);
  } finally {
    await prisma.printedDocument.deleteMany({ where: { sourceId: shipment.id } });
    await prisma.roll.deleteMany({ where: { id: { in: [r1.id, r2.id] } } });
    await prisma.sack.deleteMany({ where: { shipmentId: shipment.id } });
    await prisma.shipment.delete({ where: { id: shipment.id } }).catch(() => {});
    await prisma.color.delete({ where: { id: color.id } }).catch(() => {});
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {});
  }
}

async function main() {
  part1Pure();
  part3ListHeader();
  await part2Db();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

// =============================================================================
// UNIT TEST: ORTAK belge yoğunluk profili + alan bazlı yazı ayarı (6 belge)
// Çalıştır: npx tsx scripts/test_doc_density_fields.ts
// =============================================================================
// Kapsam: sevk irsaliyesi · fasondan sevk · fason kabul · kartela çeki · kalite
// sertifikası · iade irsaliyesi. (Fason çeki ve refakat kartının KENDİ bekçileri
// var — onların profilleri ayrı dosyalarda yaşıyor.)
//
// Gerçek DB/sunucu GEREKMEZ: renderer'lar saf (snapshot → HTML string).
//
// NEDEN VAR: belgeler A4'e göre sabit px ile yazılmıştı ama panel A5'i
// seçtiriyordu. Ölçüldü (headless Chrome, 2026-08-05): fasondan sevk A5'te
// 149px YATAY taşıyordu (kâğıdın sağı kesilir), sevk irsaliyesi yazı ölçeği
// 1.4'te %131 ile İKİ SAYFAYA çıkıyordu. Ortak profil bunları kapattı;
// bu bekçi hem düzeltmeyi hem de "A4 hiç değişmedi" güvencesini kilitler.
// =============================================================================

import fs from "fs";
import path from "path";
import { DOC_DENSITY, docChromeCss, scaleF, scaleW } from "../src/services/document-render/doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "../src/services/document-render/doc-fields";
import { SAMPLE_PRINTED_DOCS } from "../src/services/document-render/sample-data";
import { renderShipmentDispatchHtml } from "../src/services/document-render/shipment-dispatch.html";
import { renderFasonDirectShipHtml } from "../src/services/document-render/fason-direct-ship.html";
import { renderFasonReceiptHtml } from "../src/services/document-render/fason-receipt.html";
import { renderKartelaCekiHtml } from "../src/services/document-render/kartela-ceki.html";
import { renderQualityCertificateHtml } from "../src/services/document-render/quality-certificate.html";
import { renderReturnDispatchHtml } from "../src/services/document-render/return-dispatch.html";
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

type R = (s: PrintedDocSnapshot, m?: Record<string, unknown>) => string;

const DOCS: { key: string; label: string; sample: keyof typeof SAMPLE_PRINTED_DOCS; render: R }[] = [
  { key: "shipmentDispatch", label: "Sevk İrsaliyesi", sample: "SHIPMENT_DISPATCH", render: renderShipmentDispatchHtml as R },
  { key: "fasonDirectShip", label: "Fasondan Sevk", sample: "SUBCONTRACTOR_DIRECT_SHIP", render: renderFasonDirectShipHtml as R },
  { key: "fasonKabul", label: "Fason Kabul", sample: "SUBCONTRACTOR_RECEIPT", render: renderFasonReceiptHtml as R },
  { key: "kartelaCeki", label: "Kartela Çeki", sample: "KARTELA_DISPATCH", render: renderKartelaCekiHtml as R },
  { key: "kaliteSertifikasi", label: "Kalite Sertifikası", sample: "QUALITY_CERTIFICATE", render: renderQualityCertificateHtml as R },
  { key: "iadeIrsaliyesi", label: "İade İrsaliyesi", sample: "RETURN_DISPATCH", render: renderReturnDispatchHtml as R },
];

function snap(sample: keyof typeof SAMPLE_PRINTED_DOCS, cfg: Record<string, unknown> | null): PrintedDocSnapshot {
  return {
    schemaVersion: 1,
    frozenAt: "2026-06-19T10:00:00.000Z",
    company: {
      name: "Adnan Şahin Tekstil",
      letterhead: { addressLine: "OSB 5. Cadde No:12", phone: "0224 000 00 00", taxInfo: "Nilüfer / 1234567890" },
      logoHash: null,
    },
    docConfigOverride: cfg,
    doc: SAMPLE_PRINTED_DOCS[sample] as Record<string, unknown>,
  } as unknown as PrintedDocSnapshot;
}

/**
 * Bir seçicinin ETKİN kural gövdesi. Satır başına çıpalıdır (yanlış kuralı
 * ölçmemek için) ve **SON** eşleşmeyi döner: ortak chrome ile belgeye özel
 * kural aynı seçiciyi eşit özgüllükte tanımlıyor, cascade'de sonra gelen
 * kazanıyor. İlk eşleşmeyi okumak, override'ı hiç görmemek demekti.
 */
function rule(html: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`, "g");
  let last = "";
  for (const m of html.matchAll(re)) last = m[1];
  return last.replace(/\s+/g, " ").trim();
}

/** Bir özelliğin ETKİN px değeri — aynı seçicinin TÜM kuralları taranır. */
function effectivePx(html: string, selector: string, prop: string): number {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`, "g");
  let val = NaN;
  for (const m of html.matchAll(re)) {
    const p = new RegExp(`${prop}:\\s*([\\d.]+)px`).exec(m[1]);
    if (p) val = Number(p[1]);
  }
  return val;
}

// ── 1) A4 PARMAK İZİ ───────────────────────────────────────────────────────
// Ortak profil devreye girerken A4 çıktısı DEĞİŞMEMELİYDİ: altı belge de
// sahada bugüne kadar bu ölçülerle basıldı. Buradaki bir sayı, `doc-density.ts`
// A4 sütunundaki bir sayının aynasıdır — biri değişirse diğeri kırmızı verir.
function testA4Fingerprint(): void {
  console.log("\n── 1) A4 parmak izi (ortak profilin A4 sütunu) ──");
  for (const doc of DOCS) {
    const html = doc.render(snap(doc.sample, null), { status: "ACTIVE" });
    const ok =
      html.includes("@page { size: A4; margin: 9mm 9mm 9mm 9mm; }") &&
      effectivePx(html, "body", "font-size") === 11 &&
      effectivePx(html, ".company", "font-size") === 16 &&
      effectivePx(html, ".title", "font-size") === 18 &&
      effectivePx(html, ".hr .ln", "font-size") === 11 &&
      effectivePx(html, ".hr .ln b", "font-size") === 12 &&
      effectivePx(html, ".sign-lbl", "font-size") === 10 &&
      effectivePx(html, ".wm", "font-size") === 96;
    check(`${doc.label}: A4 taban ölçüleri korundu`, ok);
    const sec = rule(html, ".sec th, .sec td");
    check(`${doc.label}: .sec 3px 6px / 11px`, sec.includes("padding: 3px 6px") && sec.includes("font-size: 11px"), sec.slice(0, 60));
  }
  // Sayfalama hijyeni — altı belgeden YALNIZ sevk irsaliyesinde vardı.
  for (const doc of DOCS) {
    const html = doc.render(snap(doc.sample, null), { status: "ACTIVE" });
    check(
      `${doc.label}: sayfalama hijyeni (thead tekrar + satır bölünmez)`,
      html.includes("thead { display: table-header-group; }") &&
        html.includes("tr { break-inside: avoid; page-break-inside: avoid; }"),
    );
  }
}

// ── 2) A5 YOĞUNLUK PROFİLİ ─────────────────────────────────────────────────
function testA5(): void {
  console.log("\n── 2) A5 yoğunluk profili ──");
  for (const doc of DOCS) {
    const a4 = doc.render(snap(doc.sample, null), { status: "ACTIVE" });
    const a5 = doc.render(snap(doc.sample, { style: { pageSize: "A5" } }), { status: "ACTIVE" });
    check(`${doc.label}: @page A5`, a5.includes("@page { size: A5;"));
    check(
      `${doc.label}: taban/başlık/tablo A5'te KÜÇÜLÜR`,
      effectivePx(a5, "body", "font-size") < effectivePx(a4, "body", "font-size") &&
        effectivePx(a5, ".company", "font-size") < effectivePx(a4, ".company", "font-size") &&
        effectivePx(a5, ".sec th, .sec td", "font-size") < effectivePx(a4, ".sec th, .sec td", "font-size"),
    );
  }
  // Yatay taşmanın ASIL sebebi: kutular küçülemiyordu (flex min-width:auto +
  // sabit etiket sütunu). Ölçüldü: fasondan sevk A5'te 491px alana 640px.
  const ds = renderFasonDirectShipHtml(
    snap("SUBCONTRACTOR_DIRECT_SHIP", { style: { pageSize: "A5" } }) as never,
    { status: "ACTIVE" },
  );
  check("kutular küçülebilir (min-width:0)", rule(ds, ".box").includes("min-width: 0"));
  check("kutular yer kalmazsa ALT SATIRA geçer (flex-wrap)", rule(ds, ".info").includes("flex-wrap: wrap"));
  const labelA5 = effectivePx(ds, ".box .row", "grid-template-columns");
  const dsA4 = renderFasonDirectShipHtml(snap("SUBCONTRACTOR_DIRECT_SHIP", null) as never, { status: "ACTIVE" });
  const labelA4 = effectivePx(dsA4, ".box .row", "grid-template-columns");
  check("etiket sütunu A5'te daralır", labelA5 < labelA4, `${labelA4}px → ${labelA5}px`);
  // Başlık bloğu da küçülebilmeli (yazı büyüyünce taşmasın).
  check("sağ başlık bloğu küçülebilir (min-width:0)", rule(dsA4, ".hr").includes("min-width: 0"));
}

// ── 3) ALAN BAZLI PUNTO / KALINLIK ─────────────────────────────────────────
function testFields(): void {
  console.log("\n── 3) Alan bazlı punto / kalınlık ──");
  for (const doc of DOCS) {
    const plain = doc.render(snap(doc.sample, null), { status: "ACTIVE" });
    const empty = doc.render(snap(doc.sample, { fields: {} }), { status: "ACTIVE" });
    check(`${doc.label}: fields:{} → çıktı BİREBİR aynı`, plain === empty);
    const unknown = doc.render(snap(doc.sample, { fields: { yokBoyleAlan: { size: 20 } } }), { status: "ACTIVE" });
    check(`${doc.label}: bilinmeyen alan sessizce atlanır`, plain === unknown);

    // İZOLASYON: bir alanı ayarlamak KOMŞUSUNU etkilememeli.
    const head = doc.render(snap(doc.sample, { fields: { secHead: { size: 15, weight: "black" } } }), { status: "ACTIVE" });
    check(
      `${doc.label}: secHead ayarı uygulanır`,
      rule(head, ".sheet .sec thead th").includes("font-size: 15px") &&
        rule(head, ".sheet .sec thead th").includes("font-weight: 800"),
    );
    check(`${doc.label}: secHead, hücrelere DOKUNMAZ`, !head.includes(".sheet .sec tbody td {"));
    const cell = doc.render(snap(doc.sample, { fields: { secCell: { size: 7 } } }), { status: "ACTIVE" });
    check(`${doc.label}: secCell ayrı ayarlanır`, rule(cell, ".sheet .sec tbody td").includes("font-size: 7px"));
    check(`${doc.label}: secCell, başlığa DOKUNMAZ`, !cell.includes(".sheet .sec thead th {"));
  }

  // calc()/var() YASAK — yoksa genel "Yazı ölçeği" bu alanlarda sessizce ölür.
  const scaled = renderShipmentDispatchHtml(
    snap("SHIPMENT_DISPATCH", { fields: { secCell: { size: 10 } }, style: { fontScale: 1.2 } }) as never,
    { status: "ACTIVE" },
  );
  check("alan CSS'inde calc()/var() YOK", !scaled.includes("calc(") && !scaled.includes("var(--"));
  check(
    "fontScale alan override'ının ÜSTÜNE biner (10 × 1.2 = 12)",
    rule(scaled, ".sheet .sec tbody td").includes("font-size: 12px"),
    rule(scaled, ".sheet .sec tbody td"),
  );
  // Özgüllük: `.sheet ` öneki olmadan `.company` gibi tek sınıflı alanlar yalnız
  // CSS sırasına güvenirdi.
  const comp = renderShipmentDispatchHtml(snap("SHIPMENT_DISPATCH", { fields: { company: { size: 22 } } }) as never, { status: "ACTIVE" });
  check("tek sınıflı alan da .sheet ile öneklenir", comp.includes(".sheet .company {"));
  // Deterministik sıra.
  const a = renderShipmentDispatchHtml(snap("SHIPMENT_DISPATCH", { fields: { note: { size: 12 }, company: { size: 20 } } }) as never, { status: "ACTIVE" });
  const b = renderShipmentDispatchHtml(snap("SHIPMENT_DISPATCH", { fields: { company: { size: 20 }, note: { size: 12 } } }) as never, { status: "ACTIVE" });
  check("anahtar sırası çıktıyı DEĞİŞTİRMEZ", a === b);
  // Saf üretici: override yoksa tek bayt yok.
  check("docFieldCss({}, …) boş string", docFieldCss({}, DOC_FIELD_CATALOGS.shipmentDispatch, DOC_DENSITY.A4) === "");
  check("docFieldCss(undefined, …) boş string", docFieldCss(undefined, DOC_FIELD_CATALOGS.shipmentDispatch, DOC_DENSITY.A4) === "");
}

// ── 4) BELGEYE ÖZEL KURALLAR KORUNDU ───────────────────────────────────────
// Ortak chrome her belgeye aynı kuralları basar; belgenin KENDİ kuralı ondan
// SONRA gelir ve kazanır. Bu bölüm o sözleşmeyi kilitler — sıra bozulursa
// belgeler sessizce birbirine benzer.
function testDocSpecific(): void {
  console.log("\n── 4) Belgeye özel kurallar ortak katmanı EZER ──");

  // Sevk irsaliyesi: liste başlığı hücresi bilerek DAHA BÜYÜK (12px), gövde 11.
  const sd = renderShipmentDispatchHtml(snap("SHIPMENT_DISPATCH", null) as never, { status: "ACTIVE" });
  check("sevk: .sec th.caption 12px korundu", effectivePx(sd, ".sec th.caption", "font-size") === 12);
  check("sevk: .sec td.wrap 10px korundu", effectivePx(sd, ".sec td.wrap", "font-size") === 10);
  check("sevk: müşteri alt satırı max-width 240px", rule(sd, ".hr .ln.sub").includes("max-width: 240px"));
  check("sevk: .pgb sayfa ayrımı duruyor", sd.includes(".pgb { break-before: page;"));

  // Kalite sertifikası: beyan kutusu + kendi tablo başlığı boşluğu.
  const qc = renderQualityCertificateHtml(snap("QUALITY_CERTIFICATE", null) as never, { status: "ACTIVE" });
  check("kalite: .decl duruyor", rule(qc, ".decl").includes("font-style: italic"));
  check("kalite: .tbl-cap kendi margin'i (8px)", rule(qc, ".tbl-cap").includes("margin: 8px 0 3px"));

  // İade irsaliyesi: toplam satırı vurgusu bu belgede HİÇ YOKTU — ortak katman
  // uğruna canlı bir resmi belgenin görünümü sormadan değiştirilmedi.
  const rd = renderReturnDispatchHtml(snap("RETURN_DISPATCH", null) as never, { status: "ACTIVE" });
  check("iade: toplam satırı vurgusu EKLENMEDİ", !rd.includes(".sec .tot td {"));
  check("iade: .box tek başına duran kutu (flex:none + üst boşluk)", rule(rd, ".box").includes("flex: none"));
  check("iade: .sec üst boşluğu korundu", rule(rd, ".sec").includes("margin-top: 6px"));
  check("iade: başlık hücresi büyük harfe ZORLANMAZ", rule(rd, ".sec thead th:not(.caption)").includes("text-transform: none"));
  // Diğer beşinde vurgu VAR.
  check("diğer belgelerde toplam vurgusu duruyor", sd.includes(".sec .tot td {") && qc.includes(".sec .tot td {"));

  // Saf üretici seviyesinde de doğrula (renderer'dan bağımsız).
  check("docChromeCss totRow:false → kural basılmaz", !docChromeCss(DOC_DENSITY.A4, { totRow: false }).includes(".tot td"));
  check("docChromeCss varsayılan → kural basılır", docChromeCss(DOC_DENSITY.A4).includes(".sec .tot td"));
  check("scaleW/scaleF A4'te KİMLİK", scaleW(DOC_DENSITY.A4, 240) === 240 && scaleF(DOC_DENSITY.A4, 10) === 10);
  check("scaleW/scaleF A5'te küçültür", scaleW(DOC_DENSITY.A5, 240) < 240 && scaleF(DOC_DENSITY.A5, 10) < 10);
}

// ── 5) ELECTRON AYNASI ─────────────────────────────────────────────────────
// Electron backend'i import EDEMEZ ve kataloğu elle aynalar. Ayrışmanın iki yönü
// de SESSİZDİR: panelde var/backend'de yok → ayar kaydedilir, baskı değişmez;
// backend'de var/panelde yok → alan hiçbir yerden ayarlanamaz.
function testElectronMirror(): void {
  console.log("\n── 5) Electron alan kataloğu aynası ──");
  const SRC = path.resolve(__dirname, "../../Electron/src/services/documentConfig.ts");
  if (!fs.existsSync(SRC)) {
    console.log(`  ⚠️  Electron kaynağı bulunamadı, atlandı: ${SRC}`);
    return;
  }
  const src = fs.readFileSync(SRC, "utf8");
  const block = /export const DOC_FIELD_CATALOGS: Record<string, DocFieldDef\[\]> = \{([\s\S]*?)\n\};/.exec(src);
  check("Electron DOC_FIELD_CATALOGS okunabildi", block !== null);
  if (!block) return;

  let total = 0;
  for (const [docKey, defs] of Object.entries(DOC_FIELD_CATALOGS)) {
    const secRe = new RegExp(`\\n  ${docKey}: \\[([\\s\\S]*?)\\n  \\],`);
    const sec = secRe.exec(block[1]);
    check(`${docKey}: panelde listeleniyor`, sec !== null);
    if (!sec) continue;
    const uiKeys = [...sec[1].matchAll(/\{\s*key:\s*"([^"]+)"/g)].map((m) => m[1]);
    const beKeys = defs.map((f) => f.key);
    total += uiKeys.length;
    check(`${docKey}: alanlar BİREBİR (sıra dahil)`, uiKeys.join(",") === beKeys.join(","), `${beKeys.length} alan`);
  }
  // KÖRLÜK ZEMİNİ: regex bir refactor'da boşa düşerse "fark yok" ile "hiçbir şeye
  // bakılmadı" aynı yeşile çıkardı.
  check("ayna anlamlı büyüklükte (>90 alan satırı)", total > 90, `${total} satır`);

  // Grup adları da aynalanmalı — tanınmayan grup paneldeki satırı GÖRÜNMEZ yapar.
  const groupBlock = /DOC_FIELD_GROUP_LABELS: Record<DocFieldGroup, string> = \{([\s\S]*?)\n\};/.exec(src);
  check("Electron grup etiketleri okunabildi", groupBlock !== null);
  if (groupBlock) {
    const uiGroups = new Set([...groupBlock[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]));
    const beGroups = new Set(Object.values(DOC_FIELD_CATALOGS).flat().map((f) => f.group));
    check(
      "kullanılan her grup panelde tanımlı",
      [...beGroups].every((g) => uiGroups.has(g)),
      `backend: ${[...beGroups].join(",")}`,
    );
  }
}

function main(): void {
  testA4Fingerprint();
  testA5();
  testFields();
  testDocSpecific();
  testElectronMirror();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();

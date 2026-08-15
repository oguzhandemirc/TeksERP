// =============================================================================
// UNIT TEST: Fason çeki "KUMAŞ İRSALİYESİ" HTML renderer (saf fonksiyon)
// Çalıştır: npx tsx scripts/test_fason_ceki_html.ts
// =============================================================================
// Gerçek DB/sunucu GEREKMEZ — renderFasonCekiHtml saf: snapshot → HTML string.
// Tüm cihazlar (mobil + Electron) bunu basar; format regresyonlarını anında yakalar.
// =============================================================================
import fs from "fs";
import path from "path";
import { renderFasonCekiHtml } from "../src/services/document-render/fason-ceki.html";
import { FASON_FIELDS } from "../src/services/document-render/fason-ceki.fields";
import { sanitizeDocumentsConfig } from "../src/services/system-setting.service";
import { SAMPLE_PRINTED_DOCS } from "../src/services/document-render/sample-data";
import {
  resolveStepWorkInstructions,
  resolveStepDyeColor,
} from "../src/services/helpers/fason-work-instructions.helper";

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

// renderFasonCekiHtml(snapshot, meta) — snapshot tipini gevşek kurarız (test fixture).
type AnySnap = Parameters<typeof renderFasonCekiHtml>[0];

function roll(seq: number, qty: number, width: number | null, extra: Partial<Record<string, unknown>> = {}) {
  return {
    sequence: seq,
    barcode: `BC${seq}`,
    itemCode: "PATOS",
    itemName: "PATOS",
    colorCode: null,
    colorName: null,
    dispatchedQty: qty,
    dispatchedWeight: null,
    qualityGrade: "1.KALITE",
    width,
    ...extra,
  };
}

function makeSnap(over: {
  doc?: Record<string, unknown>;
  rolls?: ReturnType<typeof roll>[];
  company?: Record<string, unknown>;
  docConfigOverride?: Record<string, unknown> | null;
} = {}): AnySnap {
  const rolls = over.rolls ?? [roll(1, 115, 150), roll(2, 100, 150), roll(3, 83, 150)];
  const totalQty = rolls.reduce((s, r) => s + r.dispatchedQty, 0);
  return {
    schemaVersion: 1,
    frozenAt: "2026-06-19T10:00:00.000Z",
    company: { name: "Adnan Şahin Tekstil", letterhead: { addressLine: "", phone: "", taxInfo: "" }, ...over.company },
    docConfigOverride: over.docConfigOverride ?? null,
    doc: {
      dispatchNo: "SD2606000013",
      dispatchedAt: "2026-06-19T10:00:00.000Z",
      driverName: null,
      plateNumber: null,
      notes: null,
      // ⚠️ `width` = belgedeki TEK EN'in kaynağı (2026-08-06). Topların `width`i
      // payload'da DURUR ama artık hiçbir yerde BASILMAZ.
      workOrder: { id: "wo1", batchNumber: "P-260619-001", type: "STOCK_PRODUCTION", width: 150 },
      subcontractor: { id: "s1", name: "Boyer Boyacılık", code: "BOYER" },
      requestedColor: "BEYAZ",
      instruction: null,
      step: { stepSequence: 1, station: { name: "Boyahane", code: "BOYA" } },
      rolls,
      totals: { rollCount: rolls.length, totalQty, totalWeight: 0 },
      ...over.doc,
    },
  } as unknown as AnySnap;
}

function countOccur(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

/**
 * Grid'de N numaralı SLOT var mı.
 *
 * ⚠️ Düz `includes(">100<")` ARAMA — metraj hücresi de `>100<` üretiyor ve test
 * yanlış sebeple yeşil kalıyordu (varsayılan 50'ye indikten sonra "slot 100 var"
 * hâlâ geçiyordu). Slot no'su yalnız `c-top` hücresinde durur.
 */
function hasSlot(html: string, n: number): boolean {
  return html.includes(`<td class="c-top">${n}</td>`);
}

// ── 1) Temel yapı + fotoğraf örneği (115/100/83 → 298) ──────────────────────
function testBasic(): void {
  console.log("\n── 1) Temel yapı / fotoğraf örneği ──");
  const html = renderFasonCekiHtml(makeSnap());
  check("doctype + html", html.startsWith("<!doctype html>") && html.includes("</html>"));
  check("başlık KUMAŞ İRSALİYESİ", html.includes("KUMAŞ İRSALİYESİ"));
  check("gönderen firma (antet)", html.includes("Adnan Şahin Tekstil"));
  check("SAYIN = fason firma", html.includes("Boyer Boyacılık"));
  check("İrsaliye No = dispatchNo", html.includes("SD2606000013"));
  check("Tarih DD.MM.YYYY", html.includes("19.06.2026"), "fmtDate");
  check("grid başlıkları Top/Metre/Cm", html.includes(">Top<") && html.includes(">Metre<") && html.includes(">Cm<"));
  // ⚠️ Cm sütunu ELLE DOLDURULAN kutudur: başlık basılır, hücreler HER ZAMAN boş.
  check("grid Cm hücreleri BOŞ (top başına değer basılmaz)",
    html.includes('<td class="c-cm"></td>') && !/<td class="c-cm">[^<]/.test(html));
  check("metreler 115/100/83", html.includes(">115<") && html.includes(">100<") && html.includes(">83<"));
  check("EN tek değer, iş emrinden (150 cm)", html.includes(">150 cm<"));
  check("toplam METRE 298", html.includes(">298<"), "115+100+83");
  check("CİNSİ ürün adı PATOS", html.includes("PATOS"));
  check("istenen renk (hedef) BEYAZ", html.includes("BEYAZ"));
  check("TOPLAM satırı", html.includes("TOPLAM"));
  check("FİYATI/TUTARI başlıkları (boş kolon)", html.includes("FİYATI") && html.includes("TUTARI"));
}

// ── 2) Varsayılan grid yapısı (5 grup × 10 satır = 50) ──────────────────────
// Sayfa başına top 2026-08-06'da 100'den 50'ye indi (kullanıcı kararı).
function testGrid(): void {
  console.log("\n── 2) Varsayılan grid (5×10 = 50 slot) ──");
  const html = renderFasonCekiHtml(makeSnap());
  // Sıra no'ları: slot 1..50 (boş hücreler bile numaralı). Köşe değerleri:
  check("slot 1 var", hasSlot(html, 1));
  check("slot 10 var (1. grubun sonu)", hasSlot(html, 10));
  check("slot 11 var (2. grubun başı)", hasSlot(html, 11));
  check("slot 50 var (son slot)", hasSlot(html, 50));
  check("slot 51 YOK (tek sayfa)", !hasSlot(html, 51));
  check("slot 100 YOK (eski form değil)", !hasSlot(html, 100));
  check("tek grid tablosu", countOccur(html, '<table class="grid"') === 1);
}

// ── 3) Çok sayfa ────────────────────────────────────────────────────────────
// Sayfa başına slot 2026-08-06'da 100 → 50 oldu, yani 150 top artık ÜÇ grid.
function testMultiPage(): void {
  console.log("\n── 3) Çok sayfa (150 top → 3 grid, sayfa başına 50) ──");
  const rolls = Array.from({ length: 150 }, (_, i) => roll(i + 1, 50, 150));
  const html = renderFasonCekiHtml(makeSnap({ rolls }));
  check("3 grid sayfası (150 / 50)", countOccur(html, '<table class="grid"') === 3);
  check("slot 150 var", hasSlot(html, 150));
  check("slot 151 YOK (fazla kutu basılmaz)", !hasSlot(html, 151));
  // Eski 100'lük forma dönülünce 2 grid — ayarın gerçekten sayfalamayı sürdüğü.
  const old = renderFasonCekiHtml(makeSnap({ rolls, docConfigOverride: { gridRows: 20 } }));
  check("gridRows=20 → 2 grid (eski davranış)", countOccur(old, '<table class="grid"') === 2);
}

// ── 4) Sayı/tarih formatlama kenar durumları ────────────────────────────────
function testFormatting(): void {
  console.log("\n── 4) Formatlama kenar durumları ──");
  const html = renderFasonCekiHtml(
    makeSnap({
      rolls: [roll(1, 100.5, 148), roll(2, 90, null)],
      // EN artık iş emrinden gelir → yuvarlama da onun üstünde ölçülür.
      doc: { workOrder: { id: "wo1", type: "STOCK_PRODUCTION", width: 147.6 } },
    }),
  );
  check("ondalık 100.5 korunur", html.includes(">100.5<"));
  check("tam sayı 90 ondalıksız", html.includes(">90<") && !html.includes(">90.0<"));
  check("yuvarlanan en 148 (147.6 → 148)", html.includes(">148 cm<"));
  const badDate = renderFasonCekiHtml(makeSnap({ doc: { dispatchedAt: "gecersiz" } }));
  check("geçersiz tarih → boş (çökmez)", typeof badDate === "string" && badDate.length > 100);
}

// ── 5) Filigranlar (draft / void / superseded) ──────────────────────────────
function testWatermarks(): void {
  console.log("\n── 5) Filigranlar ──");
  check("draft → TASLAK", renderFasonCekiHtml(makeSnap(), { draft: true }).includes("TASLAK"));
  check("VOIDED → İPTAL", renderFasonCekiHtml(makeSnap(), { status: "VOIDED" }).includes("İPTAL"));
  check("SUPERSEDED → ESKİ KOPYA", renderFasonCekiHtml(makeSnap(), { status: "SUPERSEDED" }).includes("ESKİ KOPYA"));
  check("ACTIVE → filigran yok", !renderFasonCekiHtml(makeSnap(), { status: "ACTIVE" }).includes("TASLAK"));
}

// ── 6) HTML escaping (XSS koruması) ─────────────────────────────────────────
function testEscaping(): void {
  console.log("\n── 6) HTML escaping ──");
  const html = renderFasonCekiHtml(
    makeSnap({ doc: { subcontractor: { id: "s", name: "A & <script>B</script>", code: null } } }),
  );
  check("özel karakter escape edildi", html.includes("&lt;script&gt;") && !html.includes("<script>B"));
  check("& → &amp;", html.includes("A &amp;"));
}

// ── 7) Fason talimatı (instruction) + sections toggle ───────────────────────
function testInstruction(): void {
  console.log("\n── 7) Fason talimatı bloğu ──");
  const withInstr = renderFasonCekiHtml(makeSnap({ doc: { instruction: "yıkama yapma, matlaştır" } }));
  check("talimat varsa basılır", withInstr.includes("FASON TALİMATI") && withInstr.includes("yıkama yapma"));
  const noInstr = renderFasonCekiHtml(makeSnap({ doc: { instruction: null } }));
  check("talimat yoksa blok yok", !noInstr.includes("FASON TALİMATI"));
  const off = renderFasonCekiHtml(
    makeSnap({ doc: { instruction: "x" }, docConfigOverride: { sections: { dyehouseNote: false } } }),
  );
  check("sections.dyehouseNote=false → gizli", !off.includes("FASON TALİMATI"));
}

// ── 8) docConfig override (başlık/antet/imza) ───────────────────────────────
function testDocConfig(): void {
  console.log("\n── 8) docConfig override ──");
  const t = renderFasonCekiHtml(makeSnap({ docConfigOverride: { titleOverride: "SEVK FİŞİ" } }));
  check("titleOverride uygulanır", t.includes("SEVK FİŞİ"));
  const noLh = renderFasonCekiHtml(
    makeSnap({ company: { letterhead: { addressLine: "Adres X", phone: "555", taxInfo: "VD1" } }, docConfigOverride: { showLetterhead: false } }),
  );
  check("showLetterhead=false → adres basılmaz", !noLh.includes("Adres X"));
  const noSign = renderFasonCekiHtml(makeSnap({ docConfigOverride: { showSignatures: false } }));
  check("showSignatures=false → imza yok", !noSign.includes("Teslim Eden"));
  const sign = renderFasonCekiHtml(makeSnap());
  check("varsayılan imzalar", sign.includes("Teslim Eden") && sign.includes("Teslim Alan"));
}

// ── 9) Renk yedeği (requestedColor yoksa rol rengi) ─────────────────────────
function testColorFallback(): void {
  console.log("\n── 9) Renk yedeği ──");
  const noReq = renderFasonCekiHtml(
    makeSnap({ doc: { requestedColor: null }, rolls: [roll(1, 50, 150, { colorName: "LACİVERT" })] }),
  );
  check("requestedColor yoksa rol rengi", noReq.includes("LACİVERT"));
}

// ── 10) PARTİ NO (2026-08-05) ───────────────────────────────────────────────
// Sektör standardı: lot/parti sevk belgesinin zorunlu alanıdır (SAP delivery
// `CHARG`); tekstilde boyahane parti bazında boyar, dönüş parti bazında eşleşir.
// K10 "bir sevk = bir parti" olduğu için alan TEKİLDİR (taslak yolu virgüllü
// liste basabilir — orada henüz sevk yoktur).
function testBatchNumber(): void {
  console.log("\n── 10) Parti no ──");

  const withBatch = renderFasonCekiHtml(makeSnap({ doc: { batchNumber: "P1908260007" } }));
  check("parti no basılır", withBatch.includes("P1908260007"));
  check("etiketi 'Parti No'", withBatch.includes("Parti No:"));

  // ⚠️ EN KRİTİK KONTROL — donmuş belge kuralı: alan 2026-08-05 öncesi
  // snapshot'larda YOKTUR. O belgeler yeniden basıldığında satır DOĞMAMALI ve
  // çıktı eskisiyle BİREBİR aynı kalmalı (geriye dönük doldurma YAPILMAZ).
  const legacy = renderFasonCekiHtml(makeSnap());
  check("alansız ESKİ snapshot → satır YOK", !legacy.includes("Parti No"));
  const legacyExplicitNull = renderFasonCekiHtml(makeSnap({ doc: { batchNumber: null } }));
  check("batchNumber=null → satır YOK", !legacyExplicitNull.includes("Parti No"));
  check(
    "alansız çıktı, null çıktıyla BİREBİR aynı (parmak izi korundu)",
    legacy === legacyExplicitNull,
  );

  // Bölüm aç/kapa — varsayılan AÇIK (fason firmanın operasyonel ihtiyacı),
  // yalnız açıkça `false` yazılırsa susar (blocklist mantığı).
  const off = renderFasonCekiHtml(
    makeSnap({ doc: { batchNumber: "P1908260007" }, docConfigOverride: { sections: { batchInfo: false } } }),
  );
  check("sections.batchInfo=false → basılmaz", !off.includes("P1908260007"));
  const onExplicit = renderFasonCekiHtml(
    makeSnap({ doc: { batchNumber: "P1908260007" }, docConfigOverride: { sections: { batchInfo: true } } }),
  );
  check("sections.batchInfo=true → basılır", onExplicit.includes("P1908260007"));
  const otherSection = renderFasonCekiHtml(
    makeSnap({ doc: { batchNumber: "P1908260007" }, docConfigOverride: { sections: { notes: false } } }),
  );
  check("başka bölüm kapalıyken parti ETKİLENMEZ", otherSection.includes("P1908260007"));

  // Taslak yolu (previewDownstreamFasonCeki) çoğul liste geçirebilir.
  const draft = renderFasonCekiHtml(
    makeSnap({ doc: { dispatchNo: "(TASLAK)", batchNumber: "P1908260007, P1908260008" } }),
  );
  check("taslakta çoklu parti listesi", draft.includes("P1908260007, P1908260008"));

  // XSS: parti no da diğer alanlar gibi escape edilir.
  const evil = renderFasonCekiHtml(makeSnap({ doc: { batchNumber: "<script>x</script>" } }));
  check("parti no escape edilir", !evil.includes("<script>x</script>") && evil.includes("&lt;script&gt;"));
}

// ── Yardımcı: CSS kural gövdesini seçiciye göre çıkar ───────────────────────
// `(?:^|\n)\s*` ile SATIR BAŞINA çıpalanır — aksi halde `.title` araması
// `.hr .title` satırını da yakalar ve yanlış kuralı ölçerdi.
function rule(html: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`).exec(html);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

// ── 11) A4 PARMAK İZİ (2026-08-05 yoğunluk profili) ────────────────────────
// Profil (`fason-ceki.density.ts`) devreye girerken A4 çıktısı DEĞİŞMEMELİYDİ:
// sahadaki her fason çeki bugüne kadar bu ölçülerle basıldı. A4 sütunundaki bir
// sayıyı "düzeltmek" buradan kırmızı verir — kasıtlıysa bu referans da güncellenir.
function testA4Fingerprint(): void {
  console.log("\n── 11) A4 parmak izi (yoğunluk profili A4 sütunu) ──");
  const html = renderFasonCekiHtml(makeSnap());

  check("@page A4 + 8mm kenar", html.includes("@page { size: A4; margin: 8mm 8mm 8mm 8mm; }"));
  check("gövde tabanı 11px", rule(html, "body").includes("font-size: 11px"));
  check("firma adı 16px", rule(html, ".company").includes("font-size: 16px"));
  check("başlık 18px", rule(html, ".title").includes("font-size: 18px"));
  check("SAYIN 13px / firma 15px", rule(html, ".sayin").includes("font-size: 13px") && rule(html, ".sayin b").includes("font-size: 15px"));
  check("alt satır 10px", rule(html, ".sub").includes("font-size: 10px"));
  check("ln 11px / ln b 13px", rule(html, ".ln").includes("font-size: 11px") && rule(html, ".ln b").includes("font-size: 13px"));

  const grid = rule(html, ".grid th, .grid td");
  check("grid satır yüksekliği 18px", grid.includes("height: 18px"), grid);
  check("grid punto 10px", grid.includes("font-size: 10px"));
  check("grid padding 0 2px", grid.includes("padding: 0 2px"));
  check("sütun genişlikleri 4.5% / 9% / 5%",
    rule(html, ".grid .c-top").includes("width: 4.5%") &&
      rule(html, ".grid .c-met").includes("width: 9%") &&
      rule(html, ".grid .c-cm").includes("width: 5%"));

  const totals = rule(html, ".totals th, .totals td");
  check("alt tablo 12px / padding 5px 8px", totals.includes("font-size: 12px") && totals.includes("padding: 5px 8px"));
  check("alt tablo başlığı 10px", rule(html, ".totals th").includes("font-size: 10px"));
  check("kutu etiketi 10px / metni 12px", rule(html, ".instr-lbl").includes("font-size: 10px") && rule(html, ".instr-txt").includes("font-size: 12px"));
  check("not 11px", rule(html, ".note").includes("font-size: 11px"));
  check("imza gap 24px / üst 26px", rule(html, ".sign").includes("gap: 24px") && rule(html, ".sign").includes("margin-top: 26px"));
  check("imza etiketi 10px", rule(html, ".sign-lbl").includes("font-size: 10px"));
  check("filigran 96px", rule(html, ".wm").includes("font-size: 96px"));

  // Sayfalama hijyeni — çok sayfalı çekide 2. sayfa başlıksız çıkmasın ve satır
  // sayfa sınırında BÖLÜNMESİN. Tercih değil, doğru baskının koşulu.
  check("thead sayfa başına tekrar eder", html.includes("thead { display: table-header-group; }"));
  check("satır sayfa sınırında bölünmez", html.includes("tr { break-inside: avoid; page-break-inside: avoid; }"));
}

// ── 12) A5 YOĞUNLUK PROFİLİ ────────────────────────────────────────────────
// Ölçüldü (headless Chrome, 2026-08-05): profil ÖNCESİ A5'te içerik 773px / yazı
// alanı 733px → %105, imza bloğu İKİNCİ SAYFAYA düşüyordu (sahadaki "üste
// dayamıyor alta dayıyor" şikâyeti). Profil sonrası 588px → %80.
function testA5Density(): void {
  console.log("\n── 12) A5 yoğunluk profili ──");
  const a5 = renderFasonCekiHtml(makeSnap({ docConfigOverride: { style: { pageSize: "A5" } } }));
  const a4 = renderFasonCekiHtml(makeSnap());

  check("@page A5", a5.includes("@page { size: A5;"));

  const num = (css: string, prop: string): number => {
    const m = new RegExp(`${prop}:\\s*([\\d.]+)px`).exec(css);
    return m ? Number(m[1]) : NaN;
  };
  const rowA5 = num(rule(a5, ".grid th, .grid td"), "height");
  const rowA4 = num(rule(a4, ".grid th, .grid td"), "height");
  check("grid satır yüksekliği A5 < A4", rowA5 < rowA4, `${rowA5} < ${rowA4}`);
  check("grid puntosu A5 < A4",
    num(rule(a5, ".grid th, .grid td"), "font-size") < num(rule(a4, ".grid th, .grid td"), "font-size"));
  check("gövde tabanı A5 < A4", num(rule(a5, "body"), "font-size") < num(rule(a4, "body"), "font-size"));
  check("imza üstü boşluğu A5 < A4",
    num(rule(a5, ".sign"), "margin-top") < num(rule(a4, ".sign"), "margin-top"));

  // Kaba yükseklik bütçesi: A5 yazı alanı 194mm ≈ 733px. Satır yüksekliği tek
  // başına bütçenin yarısını yememeli (21 satır × yükseklik).
  check("21 grid satırı A5 bütçesinin yarısını aşmaz", 21 * rowA5 < 733 / 2, `${(21 * rowA5).toFixed(0)}px`);

  // A5 yalnız YOĞUNLUĞU değiştirir — içerik/yapı aynı kalır.
  check("A5'te de çeki gövdesi tam", a5.includes("KUMAŞ İRSALİYESİ") && a5.includes("TOPLAM"));
}

// ── 13) ALAN BAZLI PUNTO / KALINLIK ────────────────────────────────────────
// Saha isteği: "metre ve cm verilerinin büyüklüğü kalınlığı ayrıca belirlenemiyor".
function testFieldStyles(): void {
  console.log("\n── 13) Alan bazlı punto / kalınlık ──");
  const plain = renderFasonCekiHtml(makeSnap());

  // KURAL 1 — override yoksa TEK BAYT ek CSS basılmaz.
  const emptyFields = renderFasonCekiHtml(makeSnap({ docConfigOverride: { fields: {} } }));
  check("fields:{} → çıktı birebir aynı", plain === emptyFields);
  const unknownOnly = renderFasonCekiHtml(makeSnap({ docConfigOverride: { fields: { yokBoyleAlan: { size: 20 } } } }));
  check("bilinmeyen alan → çıktı birebir aynı (sessizce atlanır)", plain === unknownOnly);

  // METRE ve CM AYRI ayarlanabilmeli — asıl istek buydu.
  const metre = renderFasonCekiHtml(
    makeSnap({ docConfigOverride: { fields: { gridMetre: { size: 16, weight: "black" } } } }),
  );
  check("gridMetre kuralı basılır", metre.includes(".sheet .grid tbody .c-met {"));
  check("gridMetre puntosu uygulanır", rule(metre, ".sheet .grid tbody .c-met").includes("font-size: 16px"));
  check("gridMetre kalınlığı uygulanır", rule(metre, ".sheet .grid tbody .c-met").includes("font-weight: 800"));
  check("gridMetre TOP'a DOKUNMAZ", !metre.includes(".sheet .grid tbody .c-top {"));

  // ⚠️ `gridCm` alanı KALDIRILDI (grid'de EN sütunu yok). Eski kayıtlardaki
  // override sessizce atlanmalı — baskıyı düşürmemeli, CSS de üretmemeli.
  const cm = renderFasonCekiHtml(makeSnap({ docConfigOverride: { fields: { gridCm: { size: 7 } } } }));
  check("eski gridCm ayarı sessizce yok sayılır", !cm.includes(".sheet .grid tbody .c-cm"));
  check("eski gridCm ayarı baskıyı düşürmez", cm.includes("KUMAŞ İRSALİYESİ"));

  // Özgüllük: alan kuralı `.sheet ` önekiyle taban kuralı EZER. Önek düşerse
  // `.grid tbody .c-met` yine kazanırdı ama `.company` gibi tek-sınıflı alanlar
  // yalnız sıraya güvenirdi — bu kontrol öneki kilitler.
  const comp = renderFasonCekiHtml(makeSnap({ docConfigOverride: { fields: { company: { size: 22 } } } }));
  check("tek sınıflı alan da .sheet ile öneklenir", comp.includes(".sheet .company {"));

  // KURAL 2 — nihai px DÜZ yazılır; `calc()`/`var()` kullanılırsa belge geneli
  // "Yazı ölçeği" ayarı bu alanlarda SESSİZCE çalışmaz olurdu.
  const scaled = renderFasonCekiHtml(
    makeSnap({ docConfigOverride: { fields: { gridMetre: { size: 10 } }, style: { fontScale: 1.2 } } }),
  );
  check("alan CSS'inde calc()/var() YOK", !scaled.includes("calc(") && !scaled.includes("var(--"));
  check("fontScale alan override'ının ÜSTÜNE biner (10 × 1.2 = 12)",
    rule(scaled, ".sheet .grid tbody .c-met").includes("font-size: 12px"),
    rule(scaled, ".sheet .grid tbody .c-met"));

  // Yalnız verilen özellik yazılır (punto verildi, kalınlık verilmedi → taban).
  const sizeOnly = renderFasonCekiHtml(makeSnap({ docConfigOverride: { fields: { note: { size: 14 } } } }));
  check("yalnız punto verilince kalınlık yazılmaz",
    rule(sizeOnly, ".sheet .note").includes("font-size: 14px") && !rule(sizeOnly, ".sheet .note").includes("font-weight"));
  const weightOnly = renderFasonCekiHtml(makeSnap({ docConfigOverride: { fields: { note: { weight: "light" } } } }));
  check("yalnız kalınlık verilince punto yazılmaz",
    rule(weightOnly, ".sheet .note").includes("font-weight: 300") && !rule(weightOnly, ".sheet .note").includes("font-size"));

  // Deterministik sıra: aynı ayar her seferinde aynı CSS'i üretmeli (aksi halde
  // `isTemplateStale` gibi karşılaştırmalar yanlış "değişmiş" derdi).
  const a = renderFasonCekiHtml(makeSnap({ docConfigOverride: { fields: { note: { size: 12 }, company: { size: 20 } } } }));
  const b = renderFasonCekiHtml(makeSnap({ docConfigOverride: { fields: { company: { size: 20 }, note: { size: 12 } } } }));
  check("anahtar sırası çıktıyı DEĞİŞTİRMEZ (deterministik)", a === b);
}

// ── 14) YENİ BÖLÜMLER: kumaş üst bloğu · hesap no · parti konumu ───────────
function testNewSections(): void {
  console.log("\n── 14) Kumaş üst bloğu / hesap no / parti konumu ──");

  // (a) HESAP NO — artık OPT-IN. Saha "kaldır" dedi; anahtar taşımayan ESKİ
  // donmuş belgeler de basmaz (bilinçli — iç firma kodu, resmi rakam değil).
  const plain = renderFasonCekiHtml(makeSnap());
  check("hesap no varsayılan BASILMAZ", !plain.includes("Hesap:"));
  const acc = renderFasonCekiHtml(makeSnap({ docConfigOverride: { sections: { accountNo: true } } }));
  check("sections.accountNo=true → basılır", acc.includes("Hesap: BOYER"));
  const accOff = renderFasonCekiHtml(makeSnap({ docConfigOverride: { sections: { accountNo: false } } }));
  check("sections.accountNo=false → basılmaz", !accOff.includes("Hesap:"));
  check("hesap no kapalıyken istasyon/iş emri satırı DURUR", plain.includes("Boyahane"));

  // (b) CİNS / EN / RENK satırları — PARTİ NO'NUN ALTINA (2026-08-06 saha isteği:
  // "sayfada 1'den fazla kez olacak" — üstte bu satırlar, altta toplam tablosu).
  // OPT-IN: yeni satırlar eski belgelere sızmasın.
  check("üst satırlar varsayılan BASILMAZ", !plain.includes("ln-fabric"));
  const rolls = [
    roll(1, 100, 150, { itemName: "PATOS", colorName: "LACİVERT" }),
    roll(2, 120, 140, { itemName: "MUS-001", colorName: "SİYAH" }),
    roll(3, 90, 150, { itemName: "PATOS", colorName: "LACİVERT" }),
  ];
  const fab = renderFasonCekiHtml(
    makeSnap({ rolls, doc: { requestedColor: null }, docConfigOverride: { sections: { fabricHeader: true } } }),
  );
  check("üst satırlar açılır", fab.includes('class="ln ln-fabric"'));
  // ETİKETSİZ TEK SATIR (kullanıcı kararı): "cins · en · renk", key-value YOK.
  // ⚠️ EN artık TEK DEĞER ve İŞ EMRİNDEN gelir — topların enleri (150, 140)
  // listelenmez (2026-08-06). Fixture'ın iş emri eni 150.
  check(
    "cins · en · renk TEK satırda, yan yana",
    fab.includes("PATOS, MUS-001 &nbsp;·&nbsp; 150 cm &nbsp;·&nbsp; LACİVERT, SİYAH"),
  );
  check("topların en LİSTESİ basılmaz", !fab.includes("150, 140"));
  check(
    "key-value etiketi YOK",
    !fab.includes("Cinsi:") && !fab.includes("En: <b>") && !fab.includes("Renk:"),
  );
  check("tek satır basılır", countOccur(fab, 'class="ln ln-fabric"') === 1);

  // ⚠️ Kapalı blok GÖVDEYE BOŞ SATIR BIRAKMAMALI: koşullu parça kendi satır
  // başını taşır, gövdede kendi satırında `${...}` olarak DURMAZ. Aksi halde
  // ayarı hiç açmamış her belgenin çıktısı sessizce bir satır kayardı.
  const offExplicit = renderFasonCekiHtml(makeSnap({ docConfigOverride: { sections: { fabricHeader: false } } }));
  check("kapalı → çıktı ayarsızla BİREBİR aynı", plain === offExplicit);
  const bodyLines = (s: string) => s.slice(s.indexOf("<body>")).split("\n").length;
  const fhOff = renderFasonCekiHtml(makeSnap({ rolls, docConfigOverride: { sections: { fabricHeader: false } } }));
  const fhOn = renderFasonCekiHtml(makeSnap({ rolls, docConfigOverride: { sections: { fabricHeader: true } } }));
  check("açık → gövdeye TAM 1 satır ekler, kapalı → 0",
    bodyLines(fhOn) === bodyLines(fhOff) + 1,
    `${bodyLines(fhOff)} → ${bodyLines(fhOn)}`);

  // Satırlar PARTİ NO ile aynı blokta ve ONUN ALTINDA olmalı — istek buydu.
  const hlIdx0 = fab.indexOf('<div class="hl">');
  const hrIdx0 = fab.indexOf('<div class="hr">');
  check("varsayılan: parti no ile birlikte SAĞ blokta", fab.indexOf("ln-fabric") > hrIdx0);
  const fabLeft = renderFasonCekiHtml(
    makeSnap({
      rolls,
      doc: { batchNumber: "P07" },
      docConfigOverride: { sections: { fabricHeader: true }, placements: { batchInfo: "left" } },
    }),
  );
  check("parti no SOLA alınınca satırlar da SOLA gider",
    fabLeft.indexOf("ln-fabric") > fabLeft.indexOf('<div class="hl">') &&
      fabLeft.indexOf("ln-fabric") < fabLeft.indexOf('<div class="hr">'));
  check("satırlar parti no'nun ALTINDA (sonrasında)",
    fabLeft.indexOf("ln-batch") < fabLeft.indexOf("ln-fabric"));
  void hlIdx0;

  // Hedef renk varsa listenin BAŞINDA olmalı (fasoncuya "şu renge boya" der).
  const fabTarget = renderFasonCekiHtml(
    makeSnap({ rolls, doc: { requestedColor: "BEJ" }, docConfigOverride: { sections: { fabricHeader: true } } }),
  );
  check("hedef renk listenin başında", fabTarget.includes("BEJ, LACİVERT, SİYAH"));
  // Renk bilgisi kapalıysa üst satırlarda da renk YOK (tek anahtar, iki yüzey).
  const fabNoColor = renderFasonCekiHtml(
    makeSnap({ rolls, docConfigOverride: { sections: { fabricHeader: true, requestedColor: false } } }),
  );
  check("requestedColor=false → renk YOK, cins durur",
    !fabNoColor.includes("LACİVERT") && fabNoColor.includes("PATOS, MUS-001"));
  // ⚠️ "EN elle doldurulacak" ayarı açıkken EN üstte de BASILMAZ — aksi halde
  // belge bir yerde "boş bırak" derken öbür yerde değeri söylerdi.
  const fabBlank = renderFasonCekiHtml(
    makeSnap({ rolls, docConfigOverride: { sections: { fabricHeader: true }, blankWidths: true } }),
  );
  check("blankWidths=true → EN basılmaz (belge kendiyle çelişmez)",
    !fabBlank.includes("150 cm") && fabBlank.includes("PATOS, MUS-001"));

  // (c) ÖLÜ TOGGLE'LAR artık gerçekten çalışıyor (2026-08-05'e kadar panel
  // kapatıyor, belge basmaya devam ediyordu).
  const noSub = renderFasonCekiHtml(makeSnap({ docConfigOverride: { sections: { subcontractorInfo: false } } }));
  check("sections.subcontractorInfo=false → SAYIN satırı gider", !noSub.includes("SAYIN:"));
  check("SAYIN varsayılan basılır", plain.includes("SAYIN:"));
  const noColor = renderFasonCekiHtml(makeSnap({ docConfigOverride: { sections: { requestedColor: false } } }));
  check("sections.requestedColor=false → CİNSİ hücresinde renk yok",
    !noColor.includes("· BEYAZ") && plain.includes("· BEYAZ"));

  // (d) PARTİ NO SOL/SAĞ.
  const withBatch = { doc: { batchNumber: "P07" } };
  const right = renderFasonCekiHtml(makeSnap(withBatch));
  const left = renderFasonCekiHtml(
    makeSnap({ ...withBatch, docConfigOverride: { placements: { batchInfo: "left" } } }),
  );
  const hlIdx = (h: string) => h.indexOf('<div class="hl">');
  const hrIdx = (h: string) => h.indexOf('<div class="hr">');
  const batIdx = (h: string) => h.indexOf("ln-batch");
  check("varsayılan SAĞ blokta", batIdx(right) > hrIdx(right));
  check("placements.batchInfo=left → SOL bloğa taşınır",
    batIdx(left) > hlIdx(left) && batIdx(left) < hrIdx(left));
  check("sol/sağ yalnız KONUMU değiştirir, değeri değil", left.includes("P07") && right.includes("P07"));
  const rightExplicit = renderFasonCekiHtml(
    makeSnap({ ...withBatch, docConfigOverride: { placements: { batchInfo: "right" } } }),
  );
  check("placements.batchInfo=right → varsayılanla BİREBİR aynı", rightExplicit === right);
}

// ── 14b) TEK EN DEĞERİ — kaynak İŞ EMRİ (2026-08-06) ───────────────────────
//
// Saha vakası: EN kolonu açıktı, "Sistemden al" modundaydı, panel doğruydu —
// ama kâğıtta değer YOKTU. Sebep: belge topun eninden besleniyordu ve KK1'de en
// opsiyonel olduğu için sahadaki topların çoğunda NULL (8 fason sevkinin 7'sinde
// giden topların HEPSİ boştu), iş emrinin eni ise her zaman dolu.
//
// Kural: belgede TEK EN vardır ve `doc.workOrder.width`'ten gelir. Topun eni
// artık hiçbir yüzeyi beslemez — bu bölüm o bağın geri kurulmasını engeller.
function testSingleWidth(): void {
  console.log("\n── 14b) Tek EN değeri (kaynak: iş emri) ──");

  // (a) Toplar BOŞ olsa da iş emri eni basılır — düzeltmenin ta kendisi.
  const noRollWidth = [roll(1, 58, null), roll(2, 300, null)];
  const fixed = renderFasonCekiHtml(makeSnap({ rolls: noRollWidth }));
  check("topların eni NULL iken bile EN basılır", fixed.includes(">150 cm<"));

  // (a2) ⚠️ EN ÇİFTİ AYRI YÖNETİLİR: grid'in Cm KUTULARI (elle doldurulur) ile
  // belgenin bildiği tek EN (alt tablo, iş emrinden) iki farklı ayardır.
  // Toplarda dolu `width` olsa BİLE grid kutuları boş kalmalı.
  const withRollWidth = renderFasonCekiHtml(makeSnap({ rolls: [roll(1, 58, 220), roll(2, 300, 220)] }));
  // `[^<]` = hücrede kapanış etiketinden BAŞKA bir şey var mı. `\S` YANLIŞTI:
  // boş hücrede bile bir sonraki karakter `<` olduğu için her zaman eşleşiyordu.
  check("topun eni DOLU olsa da grid kutuları boş", !/<td class="c-cm">[^<]/.test(withRollWidth));
  check("grid kutuları iş emri eniyle de DOLDURULMAZ", !withRollWidth.includes('<td class="c-cm">150'));

  // (a3) Grid'in Cm sütunu KAPATILABİLİR — saha isteği ("40 satırlık listedeki
  // en sütununu kapatabilelim"). Kapatmak alt tablodaki EN'i ETKİLEMEZ.
  const gridOff = renderFasonCekiHtml(makeSnap({ docConfigOverride: { sections: { gridWidth: false } } }));
  check("sections.gridWidth=false → Cm sütunu gider",
    !gridOff.includes(">Cm<") && !gridOff.includes('class="c-cm"'));
  check("Cm kapalıyken Top/Metre DURUR", gridOff.includes(">Top<") && gridOff.includes(">Metre<"));
  check("Cm kapalıyken alt tablodaki EN DURUR", gridOff.includes(">150 cm<"));
  // Kapalıyken METRE, Cm'in payını alır → tablo dar kalıp sola yaslanmaz.
  check("Cm kapalıyken METRE genişler (14%)", rule(gridOff, ".grid .c-met").includes("width: 14%"));
  check("Cm kapalıyken c-cm kuralı hiç basılmaz", !gridOff.includes(".c-cm"));

  // (b) ⚠️ REGRESYON KAPISI: iş emrinin eni yoksa EN BOŞ kalır — topun eninden
  // BESLENMEZ. Bu kontrol düşerse eski (yanlış) kaynak sessizce geri gelir.
  const woNull = renderFasonCekiHtml(
    makeSnap({ rolls: [roll(1, 58, 220), roll(2, 300, 220)], doc: { workOrder: { id: "wo1", type: "STOCK_PRODUCTION", width: null } } }),
  );
  check("iş emri eni yoksa EN BOŞ — topun eninden beslenmez",
    !woNull.includes("220 cm") && !woNull.includes(">220<"));
  check("iş emri eni yokken de grid kutuları çizilir (form alanı)",
    woNull.includes('<td class="c-cm"></td>'));

  // (c) Toplar FARKLI enlerde olsa da belge tek değeri (iş emrininkini) basar.
  const mixed = renderFasonCekiHtml(makeSnap({ rolls: [roll(1, 58, 140), roll(2, 300, 160)] }));
  check("karışık en'li sevkte de TEK değer basılır", mixed.includes(">150 cm<"));
  check("karışık en'ler listelenmez", !mixed.includes("140") && !mixed.includes("160"));

  // (d) ESKİ DONMUŞ BELGE — `workOrder.width` alanı YOK (2026-08-05 öncesi).
  // EN boş kalır ve belge bugünküyle birebir aynı basılır; geriye dönük
  // doldurma YAPILMAZ (`reissue` tazeler). Parti no eklenirken de aynı kural.
  const legacy = renderFasonCekiHtml(
    makeSnap({ doc: { workOrder: { id: "wo1", type: "STOCK_PRODUCTION" } } }),
  );
  check("eski snapshot (width alanı yok) → EN boş", !legacy.includes(" cm<"));
  check("eski snapshot yine de basılır", legacy.includes("KUMAŞ İRSALİYESİ") && legacy.includes(">115<"));

  // (e) "Elle yazılacak" modu değeri BİLSE DE bastırmaz.
  const blank = renderFasonCekiHtml(makeSnap({ docConfigOverride: { blankWidths: true } }));
  check("blankWidths=true → EN hücresi boş", !blank.includes("150 cm"));
  check("blankWidths EN dışına DOKUNMAZ", blank.includes(">115<") && blank.includes(">298<"));

  // (f) EN kolonu kapatılabilir olmayı sürdürür (alt tablo kolon ayarı).
  const enOff = renderFasonCekiHtml(
    makeSnap({ docConfigOverride: { columns: { totals: { hidden: ["en"] } } } }),
  );
  check("columns.totals.hidden=[en] → kolon gider", !enOff.includes(">EN<") && !enOff.includes("150 cm"));
  check("EN kapalıyken diğer kolonlar DURUR", enOff.includes(">TOP<") && enOff.includes(">METRE<"));

  // (g) ⚠️ ÖNİZLEME = GERÇEK BASKI. Belge Şablonları'nın canlı önizlemesi örnek
  // veriden basılır; oraya `workOrder.width` konmazsa ayarı yapan kişi EN'i BOŞ
  // görür ama sahadaki baskı dolu çıkar. Sözleşme burada mekanik kilitlenir.
  const sample = SAMPLE_PRINTED_DOCS.SUBCONTRACTOR_DISPATCH as { workOrder?: { width?: number | null } };
  check("örnek veri iş emri eni taşır", typeof sample.workOrder?.width === "number");
}

// ── 15) GRID GRUP SAYISI ───────────────────────────────────────────────────
// A5'te 15 kolon 132mm'ye sıkışıyor; punto büyütmek metni kırpıyordu. Grup
// sayısını düşürmek "yazıyı büyütmek istiyorum" isteğinin yapısal karşılığı.
function testGridGroups(): void {
  console.log("\n── 15) Grid grup sayısı ──");
  const def = renderFasonCekiHtml(makeSnap());
  check("varsayılan 5 grup (satırda 5 'Top' başlığı)", countOccur(def, '<th class="c-top">Top</th>') === 5);
  // ⚠️ VARSAYILAN 2026-08-06'da 100 → 50 (kullanıcı kararı; 5 grup × 10 satır).
  // Hücreler elle doldurulan BOŞ kutulardır, veri değil — 100'lük formda çoğu
  // boş basılıyordu. Eski donmuş çekiler de yeniden basılınca 50 kutu çizer.
  check("varsayılan sayfa başına 50 slot", hasSlot(def, 50) && !hasSlot(def, 51));
  check("varsayılan sütun genişlikleri değişmedi", def.includes("width: 4.5%") && def.includes("width: 9%"));

  const g3 = renderFasonCekiHtml(makeSnap({ docConfigOverride: { gridGroups: 3 } }));
  check("gridGroups=3 → satırda 3 grup", countOccur(g3, '<th class="c-top">Top</th>') === 3);
  check("gridGroups=3 → sayfa başına 30 slot", hasSlot(g3, 30) && !hasSlot(g3, 31));
  check("gridGroups=3 → sütunlar genişler (7.5% / 15%)",
    g3.includes("width: 7.5%") && g3.includes("width: 15%"));

  const g4 = renderFasonCekiHtml(makeSnap({ docConfigOverride: { gridGroups: 4 } }));
  check("gridGroups=4 → 40 slot", hasSlot(g4, 40) && !hasSlot(g4, 41));

  // SATIR SAYISI ayarlanabilir — sayfa başına top adedini asıl belirleyen bu.
  const r20 = renderFasonCekiHtml(makeSnap({ docConfigOverride: { gridRows: 20 } }));
  check("gridRows=20 → eski 100’lük form geri gelir", hasSlot(r20, 100) && !hasSlot(r20, 101));
  const r5 = renderFasonCekiHtml(makeSnap({ docConfigOverride: { gridRows: 5 } }));
  check("gridRows=5 → 25 slot", hasSlot(r5, 25) && !hasSlot(r5, 26));
  const mix = renderFasonCekiHtml(makeSnap({ docConfigOverride: { gridGroups: 3, gridRows: 4 } }));
  check("grup × satır çarpılır (3 × 4 = 12)", hasSlot(mix, 12) && !hasSlot(mix, 13));
  // Grid TABLOSUNUN İÇİNDEKİ satırları say — belgede başka tablolar da var
  // (alt toplam), tüm HTML'de <tr> saymak onları da toplardı.
  const gridOnly = mix.slice(mix.indexOf('<table class="grid">'), mix.indexOf("</table>"));
  check("satır sayısı gerçekten satır üretir (1 başlık + 4 gövde)",
    countOccur(gridOnly, "<tr>") === 1 + 4, `${countOccur(gridOnly, "<tr>")} tr`);

  // 51 top / varsayılan 50 → ikinci tablo doğar ve numara 51'den devam eder.
  const many = Array.from({ length: 51 }, (_, i) => roll(i + 1, 100, 150));
  const manyHtml = renderFasonCekiHtml(makeSnap({ rolls: many }));
  check("51 top → iki grid tablosu", countOccur(manyHtml, '<table class="grid">') === 2);
  check("ikinci tabloda 51. slot", hasSlot(manyHtml, 51));

  // SÖZLEŞME: sayı olan değer ARALIĞA KIRPILIR, sayı olmayan değer VARSAYILANA
  // düşer. İkisi de baskı yolunu düşürmez — bir yazım hatası yüzünden vardiyayı
  // kâğıtsız bırakmak, biraz tuhaf yerleşimli bir çekiden kötüdür.
  const bad = renderFasonCekiHtml(makeSnap({ docConfigOverride: { gridGroups: 9, gridRows: "abc" } }));
  check("sayı olmayan grup/satır → varsayılan (çıktı birebir)", bad === def);
  const clampHi = renderFasonCekiHtml(makeSnap({ docConfigOverride: { gridRows: 999 } }));
  check("gridRows 40’a kırpılır (5 × 40 = 200)", hasSlot(clampHi, 200) && !hasSlot(clampHi, 201));
  const clampLo = renderFasonCekiHtml(makeSnap({ docConfigOverride: { gridRows: 0 } }));
  check("gridRows 1’e kırpılır (5 × 1 = 5)", hasSlot(clampLo, 5) && !hasSlot(clampLo, 6));
}

// ── 16) ELECTRON AYNASI — alan kataloğu iki tarafta BİREBİR ────────────────
// Electron backend'i import EDEMEZ (ayrı proje) ve kataloğu elle aynalar.
// Ayrışmanın iki yönü de SESSİZDİR ve ikisi de kullanıcıyı çıkmaza sokar:
//   • panelde var / backend'de yok → kullanıcı ayarlar, kaydeder, baskı DEĞİŞMEZ
//   • backend'de var / panelde yok → alan hiçbir yerden ayarlanamaz
function testElectronMirror(): void {
  console.log("\n── 16) Electron alan kataloğu aynası ──");
  const SRC = path.resolve(__dirname, "../../Electron/src/services/documentConfig.ts");
  if (!fs.existsSync(SRC)) {
    console.log(`  ⚠️  Electron kaynağı bulunamadı, ayna kontrolü atlandı: ${SRC}`);
    return;
  }
  const src = fs.readFileSync(SRC, "utf8");
  const block = /export const FASON_FIELD_DEFS: DocFieldDef\[\] = \[([\s\S]*?)\n\];/.exec(src);
  check("Electron FASON_FIELD_DEFS okunabildi", block !== null);
  if (!block) return;

  const uiKeys = [...block[1].matchAll(/\{\s*key:\s*"([^"]+)"/g)].map((m) => m[1]);
  const beKeys = FASON_FIELDS.map((f) => f.key);

  // KÖRLÜK ZEMİNİ: regex bir refactor'da boşa düşerse "fark yok" ile "hiçbir
  // şeye bakılmadı" aynı yeşile çıkardı.
  check("ayna listesi anlamlı büyüklükte (>15 alan)", uiKeys.length > 15, `${uiKeys.length} alan`);

  const eksik = beKeys.filter((k) => !uiKeys.includes(k));
  const fazla = uiKeys.filter((k) => !beKeys.includes(k));
  check("panelde eksik alan YOK (backend'de var, ayarlanamaz)", eksik.length === 0, eksik.join(", "));
  check("panelde fazla alan YOK (ayarlanır ama baskıyı etkilemez)", fazla.length === 0, fazla.join(", "));
  check("sıra da aynı (panel = belge okuma sırası)", uiKeys.join(",") === beKeys.join(","));

  // ⚠️ ETİKETLER de aynalanır. Anahtar/sıra kontrolü bu kaymayı GÖRMEZ ve kayma
  // sessizdir: kullanıcı panelde yazanı okur, belgede başkasını görür. Gerçek
  // vaka (2026-08-06): grid'in Cm sütunu kaldırılıp geri konurken paneldeki
  // "Grid başlıkları (Top / Metre / Cm)" etiketi "(Top / Metre)"de kaldı —
  // sütun basılıyor ama panel yokmuş gibi anlatıyordu.
  const labelOf = (block: string) =>
    new Map(
      [...block.matchAll(/\{\s*key:\s*"([^"]+)",\s*label:\s*("[^"]*"|'[^']*')/g)]
        .map((m) => [m[1], m[2]!.slice(1, -1)] as const),
    );
  const uiLabels = labelOf(block[1]!);
  const labelDrift = FASON_FIELDS.filter((f) => uiLabels.get(f.key) !== f.label).map((f) => f.key);
  check("etiketler de birebir", labelDrift.length === 0, labelDrift.join(", "));

  // Grup adları da aynalanır — bilinmeyen grup paneldeki satırı GÖRÜNMEZ yapar
  // (DocumentFieldStyleControls yalnız tanıdığı grupları çizer).
  const uiGroups = new Set([...block[1].matchAll(/group:\s*"([^"]+)"/g)].map((m) => m[1]));
  const beGroups = new Set(FASON_FIELDS.map((f) => f.group));
  check("grup adları birebir",
    [...beGroups].every((g) => uiGroups.has(g)) && [...uiGroups].every((g) => beGroups.has(g as never)),
    `backend: ${[...beGroups].join(",")} | panel: ${[...uiGroups].join(",")}`);
}

// ── 17) ÖNİZLEME KAPISI — sample-html Zod şeması ayarı YUTMAMALI ──────────
// `docConfigSchema` bir `z.object`tir: tanımadığı anahtarı HATA VERMEDEN ATAR.
// Bir DocumentConfig alanı oraya yazılmazsa ayar kaydedilir, GERÇEK BASKIDA
// görünür, ama Belge Şablonları ekranının canlı önizlemesinde GÖRÜNMEZ — yani
// "önizleme = gerçek baskı" sözleşmesi ayarı yapan kişinin gözü önünde bozulur
// ve hiçbir yerde hata çıkmaz. (`columns.shown` tam bu yüzden eksik kalmıştı.)
function testPreviewSchemaParity(): void {
  console.log("\n── 17) Önizleme şeması ↔ kayıt kapısı hizası ──");
  const CTRL = path.resolve(__dirname, "../src/controllers/printed-document.controller.ts");
  const SETTINGS = path.resolve(__dirname, "../src/services/system-setting.service.ts");
  if (!fs.existsSync(CTRL) || !fs.existsSync(SETTINGS)) {
    console.log("  ⚠️  kaynak bulunamadı, hiza kontrolü atlandı");
    return;
  }
  const ctrl = fs.readFileSync(CTRL, "utf8");
  const block = /const docConfigSchema = z\n?\s*\.object\(\{([\s\S]*?)\n  \}\)/.exec(ctrl);
  check("docConfigSchema okunabildi", block !== null);
  if (!block) return;

  // Kayıt kapısındaki (sanitizeDocumentsConfig) DocumentConfig alan listesi.
  const typeBlock = /export interface DocumentConfig \{([\s\S]*?)\n\}/.exec(
    fs.readFileSync(SETTINGS, "utf8"),
  );
  check("DocumentConfig tipi okunabildi", typeBlock !== null);
  if (!typeBlock) return;

  const typeKeys = [...typeBlock[1].matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
  // Tam 4 boşluk = şemanın ÜST düzey alanı (iç içe nesnelerin alanları daha
  // derin girintili). Değer `z.…` da olabilir, adlandırılmış bir şema da
  // (`style: docStyleSchema`) — bu yüzden `z` değil `\S` aranır.
  const schemaKeys = [...block[1].matchAll(/^ {4}(\w+):\s*\S/gm)].map((m) => m[1]);

  // KÖRLÜK ZEMİNİ — regex bir refactor'da boşa düşerse "fark yok" ile "hiçbir
  // şeye bakılmadı" aynı yeşile çıkardı.
  check("tip listesi anlamlı büyüklükte (>12 alan)", typeKeys.length > 12, `${typeKeys.length} alan`);
  check("şema listesi anlamlı büyüklükte (>12 alan)", schemaKeys.length > 12, `${schemaKeys.length} alan`);

  const eksik = typeKeys.filter((k) => !schemaKeys.includes(k));
  check("önizleme şemasında eksik alan YOK (ayar sessizce yutulur)", eksik.length === 0, eksik.join(", "));
}

// ── 18) KAYIT KAPISI — sanitizeDocumentsConfig ayarı YUTMAMALI ────────────
// §17 önizleme şemasını doğruluyor; bu ise SAKLAMA tarafını. İkisi ayrı kapı ve
// ayrı sessiz başarısızlık: şema düşerse ayar kaydolur ama önizlemede görünmez,
// KAYIT kapısı düşerse kullanıcı ayarlar, Kaydet'e basar, istek 200 döner ve
// hiçbir şey olmaz — sebebi de hiçbir yerde yazmaz.
// (Bu bölüm eklenmeden önce kapı silinince HİÇBİR test kırmızı vermiyordu —
// negatif sondayla ölçüldü.)
function testStorageGate(): void {
  console.log("\n── 18) Kayıt kapısı (sanitizeDocumentsConfig) ──");
  const out = sanitizeDocumentsConfig({
    fasonSevk: {
      fields: { gridMetre: { size: 14, weight: "bold" } },
      placements: { batchInfo: "left" },
      gridGroups: 3,
      gridRows: 12,
    },
  });
  const cfg = out.fasonSevk ?? {};
  check("fields kaydedilir", cfg.fields?.gridMetre?.size === 14 && cfg.fields?.gridMetre?.weight === "bold");
  check("placements kaydedilir", cfg.placements?.batchInfo === "left");
  check("gridGroups kaydedilir", cfg.gridGroups === 3);
  check("gridRows kaydedilir", cfg.gridRows === 12);

  // Kırpma/eleme kapıda da uygulanır (istemciye güvenilmez).
  const clamped = sanitizeDocumentsConfig({
    fasonSevk: { gridRows: 999, gridGroups: 9, fields: { x: { size: 1000 } }, placements: { batchInfo: "orta" } },
  }).fasonSevk;
  check("gridRows 40'a kırpılır", clamped?.gridRows === 40);
  check("geçersiz gridGroups atılır", clamped?.gridGroups === undefined);
  check("alan puntosu 48'e kırpılır", clamped?.fields?.x?.size === 48);
  check("geçersiz konum atılır", clamped?.placements === undefined);

  // Boş/anlamsız girdi kayda GİRMEZ (yarım `{}` birikmesin).
  const empty = sanitizeDocumentsConfig({ fasonSevk: { fields: { y: {} } } }).fasonSevk;
  check("boş alan kaydı atılır", empty?.fields === undefined);

  // ⚠️ §18-EK (2026-08-15) — `sections` DALI BEKÇİSİZDİ. Dosyadaki tüm bölüm
  // kontrolleri `cfg` nesnesini ELLE kurup doğrudan renderer'a veriyor, yani kayıt
  // kapısını BYPASS ediyorlar: `sanitizeDocumentsConfig`ten `o.sections` bloğu
  // silinse hiçbir test kırmızı vermiyordu (negatif sondayla ölçüldü). Bu, §18'in
  // yazılma gerekçesinin birebir tekrarı — kullanıcı bölümü kapatır, Kaydet'e
  // basar, istek 200 döner ve hiçbir şey olmaz.
  const sec = sanitizeDocumentsConfig({
    fasonSevk: { sections: { dyeColorLine: false, productionProps: true } },
  }).fasonSevk;
  check("§18-EK bölüm ayarı kaydedilir",
    sec?.sections?.dyeColorLine === false && sec?.sections?.productionProps === true);
  const badSec = sanitizeDocumentsConfig({
    fasonSevk: { sections: { x: "evet", y: 1, z: null, gercek: true } },
  }).fasonSevk;
  check("§18-EK boolean olmayan bölüm değeri elenir",
    badSec?.sections !== undefined &&
      !("x" in badSec.sections) && !("y" in badSec.sections) && !("z" in badSec.sections) &&
      badSec.sections.gercek === true);
}

// ── 14c) TALİMAT KUTUSU — "BOYANACAK RENK" / "YAPILACAK İŞLEMLER" ──────────
//
// SAHA (2026-08-15, birebir): "boyahaneye gönderilen çeki listesinde boyanacak
// renk daha belirgin ve birkaç yerde yazsın … 'BOYANACAK RENK : MAVİ' bunun gibi
// net şekilde istiyor" + "iş emrinde renk olmayabilir ama mutlaka boyahanede
// yapılacak bir üretim özelliği vardır. o özellikler de 'YAPILACAK İŞLEMLER :
// APRE' örnekteki gibi net şekilde yazalım".
//
// ⚠️ İKİ TUZAK BU BÖLÜMDE MEKANİK OLARAK KİLİTLİ:
//   1. ETİKET YALAN SÖYLEYEMEZ — `requestedColor` bilinçli olarak "hedef yoksa
//      TOPLARIN mevcut rengi"dir (renderer'daki `renk` değişkeni). O değerin
//      üstüne "BOYANACAK RENK" etiketi konulsaydı ham/ekru topa "EKRU'ya boya"
//      talimatı giderdi. Kutu YALNIZ `doc.commands.color`'ı okur; fallback YOK.
//   2. DONMUŞ BELGE — koruma CONFIG'ten değil VERİDEN gelir: `sections` bir
//      blocklist'tir ("anahtar yoksa AÇIK") ve `docConfigOverride` da donmuştur,
//      yani config kapılaması geçmişe karşı SIFIR koruma verirdi. `doc.commands`
//      2026-08-15 öncesi 113 snapshot'ın hiçbirinde yok → tek bayt basılmaz.
function testCommandBox(): void {
  console.log("\n── 14c) Talimat kutusu (BOYANACAK RENK / YAPILACAK İŞLEMLER) ──");

  const cmdDoc = (color: string | null, works: Array<{ name: string; value?: string | null }>) => ({
    commands: { color, works },
  });
  const plainLegacy = renderFasonCekiHtml(makeSnap()); // `commands` YOK = eski snapshot

  // (1-2) VARSAYILAN AÇIK — blocklist ispatı: hiçbir config verilmeden basılır.
  const both = renderFasonCekiHtml(makeSnap({ doc: cmdDoc("MAVİ", [{ name: "APRE" }]) }));
  check("§14c-1 config YOK + renk dolu → BOYANACAK RENK basılır",
    both.includes("BOYANACAK RENK") && both.includes(">MAVİ<"));
  check("§14c-2 config YOK + işlem dolu → YAPILACAK İŞLEMLER basılır",
    both.includes("YAPILACAK İŞLEMLER") && both.includes(">APRE<"));
  check("iki nokta AYRI hücre (etiketler hizalanır)",
    countOccur(both, '<div class="cmd-sep">:</div>') === 2);

  // (3) KAPATMA TEK BAYT EKLEMEZ — renk satırı kapalıyken çıktı, rengi hiç
  // olmayan belgeyle BİREBİR aynı olmalı.
  const colorOff = renderFasonCekiHtml(
    makeSnap({ doc: cmdDoc("MAVİ", [{ name: "APRE" }]), docConfigOverride: { sections: { dyeColorLine: false } } }),
  );
  const colorNull = renderFasonCekiHtml(makeSnap({ doc: cmdDoc(null, [{ name: "APRE" }]) }));
  check("§14c-3 dyeColorLine=false → renksiz çıktıyla BİREBİR aynı", colorOff === colorNull);

  // (4) ⚠️ EN KRİTİK — ESKİ SNAPSHOT BAYT-BAYT. Yeni bloğun eklediği bayt kümesi
  // TAM OLARAK kendi HTML satırı + kendi CSS kurallarıdır; onları çıkarınca eski
  // çıktı BİREBİR geri gelmeli. (Bu, `${...}`i kendi satırına koyma tuzağını da
  // yakalar: blok kapalıyken gövdeye boş satır girseydi eşitlik bozulurdu.)
  const stripped = both
    .replace(/\n {4}<div class="cmd">.*<\/div>/, "")
    .replace(
      /\n {2}\.cmd \{[^}]*\}\n {2}\.cmd-lbl \{[^}]*\}\n {2}\.cmd-sep \{[^}]*\}\n {2}\.cmd-val \{[^}]*\}/,
      "",
    );
  check("§14c-4 blok+CSS çıkarılınca ESKİ çıktı BİREBİR geri gelir", stripped === plainLegacy);
  check("eski snapshot'ta talimat kutusu YOK",
    !plainLegacy.includes("BOYANACAK RENK") && !plainLegacy.includes('class="cmd"'));

  // (5) ESKİ SNAPSHOT + TAZE CONFIG (`?currentTemplate=1` benzetimi): ayar AÇIKÇA
  // açık gelse bile veri yoksa kutu doğmaz. Config kapılaması olsaydı burada
  // 74 eski belge sessizce yeni bir satır kazanırdı.
  const legacyFreshCfg = renderFasonCekiHtml(
    makeSnap({ docConfigOverride: { sections: { dyeColorLine: true, instructionWarning: true } } }),
  );
  check("§14c-5 taze config + commands'sız doc → kutu YOK", legacyFreshCfg === plainLegacy);

  // (6) KULLANICININ AÇIK KURALI: renk yoksa satır BASILMAZ, işlemler tek başına yeter.
  check("§14c-6 renk yok + işlem var → boş 'BOYANACAK RENK' etiketi ÇIKMAZ",
    colorNull.includes("YAPILACAK İŞLEMLER") && !colorNull.includes("BOYANACAK RENK"));

  // (7) ⚠️ ETİKET YALAN SÖYLEMEZ — hedef renk yokken topun MEVCUT rengi
  // "BOYANACAK RENK" diye basılmaz; ama CİNSİ hücresindeki envanter beyanı DURUR.
  const ekru = renderFasonCekiHtml(
    makeSnap({
      doc: { ...cmdDoc(null, [{ name: "APRE" }]), requestedColor: "EKRU" },
      rolls: [roll(1, 50, 150, { colorName: "EKRU" })],
    }),
  );
  check("§14c-7 hedef renk yokken mevcut renk TALİMAT olarak basılmaz",
    !ekru.includes("BOYANACAK RENK"));
  check("§14c-7 aynı çıktıda CİNSİ hücresi rengi (envanter) DURUR", ekru.includes("· EKRU"));

  // (8) İki alan gerçekten bağımsız: `requestedColor` boş olsa da talimat basılır.
  const targetOnly = renderFasonCekiHtml(
    makeSnap({ doc: { ...cmdDoc("MAVİ", []), requestedColor: null } }),
  );
  check("§14c-8 requestedColor=null iken bile BOYANACAK RENK: MAVİ basılır",
    targetOnly.includes("BOYANACAK RENK") && targetOnly.includes(">MAVİ<"));

  // (9-12) BOŞLUK UYARISI. Ölçüldü: 94 sevkin 11'i (%11,7) hiçbir yazılı talimat
  // taşımıyor ve küme büyüyor — sessiz boşluk yerine görünür işaret basılır.
  const empty = renderFasonCekiHtml(makeSnap({ doc: cmdDoc(null, []) }));
  check("§14c-9 ikisi de yok → 'GİRİLMEMİŞ — SEVK EDENE SORUNUZ'",
    empty.includes("GİRİLMEMİŞ — SEVK EDENE SORUNUZ") && empty.includes(">TALİMAT<"));
  const propsOff = renderFasonCekiHtml(
    makeSnap({ doc: cmdDoc(null, [{ name: "APRE" }]), docConfigOverride: { sections: { productionProps: false } } }),
  );
  check("§14c-10 uyarı VERİ boşluğuna bakar (ayar kapalı ama veri dolu → uyarı YOK)",
    !propsOff.includes("GİRİLMEMİŞ") && !propsOff.includes('class="cmd"'));
  const warnOff = renderFasonCekiHtml(
    makeSnap({ doc: cmdDoc(null, []), docConfigOverride: { sections: { instructionWarning: false } } }),
  );
  check("§14c-11 instructionWarning=false → uyarı yok, kutu hiç doğmaz",
    !warnOff.includes("GİRİLMEMİŞ") && !warnOff.includes('class="cmd"'));
  check("§14c-12 commands'sız ESKİ belge aniden suçlayıcı kutu KAZANMAZ",
    !plainLegacy.includes("GİRİLMEMİŞ"));

  // (12b-12e) UYARI YÜKLEMİNİN ÜÇ EKSİK SİNYALİ (2026-08-15 doğrulama turu).
  // İlk hâli yalnız `color` + `works`e bakıyordu → belge KENDİ KENDİSİYLE
  // çelişebiliyordu. Üçü de gerçek veri yollarıdır, üçü de burada kilitli.
  const withInstr = renderFasonCekiHtml(
    makeSnap({ doc: { ...cmdDoc(null, []), instruction: "Yıkama yapma, matlaştır" } }),
  );
  check("§14c-12b FASON TALİMATI dolu iken 'GİRİLMEMİŞ' BASILMAZ (çelişki yok)",
    withInstr.includes("FASON TALİMATI") && !withInstr.includes("GİRİLMEMİŞ"));
  check("§14c-12b talimat tek başına yeterli → kutu hiç doğmaz",
    !withInstr.includes('class="cmd"'));
  // Adım süzgeci TÜM hedefleri elediyse talimat GİRİLMİŞTİR, sadece bu adıma ait
  // değildir (gerçek şekil: IE2207260001 → yalnız KURŞUNLU).
  const outOfScope = renderFasonCekiHtml(
    makeSnap({ doc: { ...cmdDoc(null, []), targetProperties: ["KURŞUNLU"] } }),
  );
  check("§14c-12c hedef VAR ama bu adıma ait değil → planlamacı SUÇLANMAZ",
    !outOfScope.includes("GİRİLMEMİŞ"));
  check("§14c-12c aynı çıktıda kapsam dışı hedef TALİMAT olarak da basılmaz",
    !outOfScope.includes("KURŞUNLU"));
  // Boş string / yalnız-boşluk: eskiden ne satır doğuyordu ne uyarı → belge
  // talimatsız olduğunu HİÇBİR ŞEKİLDE söylemiyordu (sessiz üçüncü hâl).
  const blankish = renderFasonCekiHtml(makeSnap({ doc: cmdDoc("   ", [{ name: " " }]) }));
  check("§14c-12d boş/boşluklu değer sessiz boş kutu üretmez → uyarı basılır",
    blankish.includes("GİRİLMEMİŞ") && !blankish.includes("BOYANACAK RENK"));
  check("§14c-12e adsız işlem satırı ': değer' olarak SIZMAZ",
    !renderFasonCekiHtml(makeSnap({ doc: cmdDoc(null, [{ name: "", value: "50 gr" }]) }))
      .includes("50 gr"));

  // (13-14) ÇİFT BASIM YASAĞI — yeni kutu doğunca eski "İSTENEN ÖZELLİKLER" susar.
  const legacyProps = renderFasonCekiHtml(makeSnap({ doc: { targetProperties: ["APRE", "AÇMAZLIK"] } }));
  const newProps = renderFasonCekiHtml(
    makeSnap({ doc: { targetProperties: ["APRE", "AÇMAZLIK"], ...cmdDoc(null, [{ name: "APRE" }]) } }),
  );
  check("§14c-13 commands VARKEN 'İSTENEN ÖZELLİKLER' basılmaz (tek talimat)",
    !newProps.includes("İSTENEN ÖZELLİKLER") && newProps.includes("YAPILACAK İŞLEMLER"));
  check("§14c-14 commands YOKKEN eski kutu AYNEN basılır",
    legacyProps.includes("İSTENEN ÖZELLİKLER") && legacyProps.includes("APRE, AÇMAZLIK"));

  // (15) ÇOKLU İŞLEM — tekil gösterime düşmez (ölçüm: sevk başına 0-2, WO'da maks 4).
  const many = renderFasonCekiHtml(
    makeSnap({
      doc: cmdDoc("EKRU", [
        { name: "APRE" },
        { name: "AÇMAZLIK" },
        { name: "YUMUŞAK TUŞE-6" },
        { name: "JET BOYA PİŞİRME" },
      ]),
    }),
  );
  check("§14c-15 dört işlemin dördü de basılır",
    ["APRE", "AÇMAZLIK", "YUMUŞAK TUŞE-6", "JET BOYA PİŞİRME"].every((w) => many.includes(w)));
  check("§14c-15 ayırıcı belgenin kendi standardı (·)", many.includes("&nbsp;·&nbsp;"));

  // (16) DETERMİNİSTİK SIRA — Prisma ilişkide satır sırasını garanti etmez; sıra
  // oynarsa freeze ile reissue aynı içeriği farklı sırada basar.
  const asc = renderFasonCekiHtml(makeSnap({ doc: cmdDoc("EKRU", [{ name: "AÇMAZLIK" }, { name: "APRE" }]) }));
  const desc = renderFasonCekiHtml(makeSnap({ doc: cmdDoc("EKRU", [{ name: "APRE" }, { name: "AÇMAZLIK" }]) }));
  check("§14c-16 ters sıralı works aynı HTML'i üretir", asc === desc);

  // (17) DEĞER-HAZIR ŞEKİL — bugün `value` hep undefined (hedef özelliklerde değer
  // kolonu YOK, SEÇİM tipli özellik hedef olamaz) → düz ad listesiyle BİREBİR aynı.
  const valued = renderFasonCekiHtml(makeSnap({ doc: cmdDoc(null, [{ name: "GRAMAJ", value: "50 gr" }]) }));
  check("§14c-17 değer varsa 'AD: DEĞER' basılır", valued.includes("GRAMAJ: 50 gr"));
  const noValue = renderFasonCekiHtml(makeSnap({ doc: cmdDoc(null, [{ name: "GRAMAJ" }]) }));
  const nullValue = renderFasonCekiHtml(makeSnap({ doc: cmdDoc(null, [{ name: "GRAMAJ", value: null }]) }));
  check("§14c-17 değer yokken yalnız ad, çıktı düz-ad fixture'ıyla BİREBİR aynı",
    noValue === nullValue && noValue.includes(">GRAMAJ<"));

  // (18) ESCAPING.
  const evil = renderFasonCekiHtml(makeSnap({ doc: cmdDoc("<script>x</script>", []) }));
  check("§14c-18 talimat değeri escape edilir",
    evil.includes("&lt;script&gt;") && !evil.includes("<script>x</script>"));

  // (19) CSS KOŞULLU EMİT — A4 parmak izi: kutu yokken tek bayt CSS basılmaz.
  check("§14c-19 commands'sız belgede .cmd kuralı HİÇ basılmaz",
    rule(plainLegacy, ".cmd") === "" && !plainLegacy.includes(".cmd {") && !plainLegacy.includes(".cmd-val"));
  check("kutu varken CSS basılır (koşul gerçekten çalışıyor)",
    rule(both, ".cmd").includes("border: 2px solid #000") && rule(both, ".cmd-val").length > 0);
  check("alan CSS'inde calc()/var() YOK (scaleDocCss regex'i görmez)",
    !both.includes("calc(") && !both.includes("var(--"));

  // (20) A5 BÜTÇESİ — canlı fabrika ayarıyla. Tarihsel vaka: A5'te %105 doluluk,
  // imza bloğu ikinci kâğıda düşüyordu. Kutunun en pahalı gerçekçi hâli ölçüldü
  // (renk + 4 işlem, iri punto) ve yazı alanının %12'sinin altında kalmalı.
  //
  // ⚠️ ÖLÇÜM (headless Chrome, gerçek belge + CANLI fabrika ayarı, 2026-08-15):
  // A5 yazı alanı ≈756px. Gerçek sevkler tek sayfa ve rahat — FS1308260009
  // 400px (%53, kutu +15px), FS1208260010 377px (kutu eski "İSTENEN
  // ÖZELLİKLER" kutusunun YERİNE geçtiği için −8px), FS1308260006 383px.
  // ⚠️ BİLİNEN SINIR, GİZLENMİYOR: imza AÇIK **+** gridRows 20 **+** fontScale
  // 1.4 ÜÇÜ BİRDEN açılırsa sayfa 785px olur (kutusuz 714px) → ikinci kâğıt.
  // Yani o uç kombinasyonda kutu belirleyici olabiliyor. Canlı ayar üçünü de
  // taşımıyor (imza kapalı · gridRows 10 · 1.1) ve ikili kombinasyonların
  // hiçbiri taşmıyor. Kutuyu küçültmek çözüm DEĞİL (saha "belirgin" istedi);
  // taşarsa doğru kol gridRows/fontScale'dir.
  const liveCfg = {
    style: { pageSize: "A5", fontScale: 1.1, fontWeight: "bold", tableDensity: "compact" },
    gridGroups: 4,
    showSignatures: false,
    sections: { gridWidth: false, vehicleInfo: false, fabricHeader: true },
  };
  const a5Live = renderFasonCekiHtml(
    makeSnap({
      doc: cmdDoc("078-BYR-K.KAHVE", [
        { name: "JET BOYA PİŞİRME" },
        { name: "AÇMAZLIK" },
        { name: "YUMUŞAK TUŞE -1" },
        { name: "KURŞUNLU" },
      ]),
      docConfigOverride: liveCfg,
    }),
  );
  const numOf = (css: string, prop: string): number => {
    const m = new RegExp(`${prop}:\\s*([\\d.]+)px`).exec(css);
    return m ? Number(m[1]) : NaN;
  };
  const valPx = numOf(rule(a5Live, ".cmd-val"), "font-size");
  const lblPx = numOf(rule(a5Live, ".cmd-lbl"), "font-size");
  // ⚠️ FORMÜL GERÇEKTEN ÖLÇER — ilk hâli satır sayısını 2'ye SABİTLİYOR ve yalnız
  // `.cmd-val` puntosunu okuyordu; `estH` her koşumda 53px, eşik 110px'ti, yani
  // kontrol MATEMATİKSEL OLARAK kırmızı veremezdi (dekoratif bekçi). Artık:
  //   • satır sayısı ÇIKTIDAN sayılır (`.cmd-lbl` adedi),
  //   • kutunun BÜTÜN dikey ölçüleri (dolgu, satır arası, üst boşluk, çerçeve)
  //     yoğunluk profilinden okunur,
  //   • uzun işlem listesinin SARMASI karakter genişliğinden kestirilir
  //     (A5 yazı alanı 132mm ≈ 499px; etiket sütunu + iki nokta düşülür),
  //   • eşik %12'ye çekilir → A5 `cmdVal`i 13→26 yapan bir "iyileştirme" kırmızı
  //     verir (eski eşikle 30'a çıksa bile yeşil kalıyordu).
  const rows = countOccur(a5Live, '<div class="cmd-lbl">');
  const longestVal = Math.max(
    ...[...a5Live.matchAll(/<div class="cmd-val">([\s\S]*?)<\/div>/g)].map((m) =>
      m[1]!.replace(/&nbsp;/g, " ").length,
    ),
    1,
  );
  const availPx = 499 - lblPx * 12 - 10; // etiket sütunu (≈12 karakter) + iki nokta
  const wrapLines = Math.max(1, Math.ceil((longestVal * valPx * 0.55) / availPx));
  const pad = numOf(rule(a5Live, ".cmd"), "padding") || 5;
  const estH =
    (rows - 1 + wrapLines) * valPx * 1.4 +
    (rows - 1) * numOf(rule(a5Live, ".cmd"), "row-gap") +
    2 * pad +
    numOf(rule(a5Live, ".cmd"), "margin-top") +
    4; // 2px × 2 çerçeve
  check("§14c-20 formül gerçekten okudu (körlük zemini)",
    rows === 2 && longestVal > 40 && Number.isFinite(estH) && estH > 20,
    `satır=${rows} enUzunDeğer=${longestVal} sarma=${wrapLines} h=${estH.toFixed(0)}px`);
  check("§14c-20 A5 canlı ayarda kutu yazı alanının %12'sini aşmaz (733px)",
    Number.isFinite(estH) && estH < 733 * 0.12, `${estH.toFixed(0)}px`);
  check("§14c-20 A5 puntoları A4'ten küçük (yoğunluk profili gerçekten uygulanıyor)",
    valPx < numOf(rule(both, ".cmd-val"), "font-size") &&
      lblPx < numOf(rule(both, ".cmd-lbl"), "font-size"));

  // ALAN BAZLI PUNTO — talimat kutusu KENDİ anahtarlarını taşır; `boxLabel`/
  // `boxText` (İSTENEN ÖZELLİKLER + FASON TALİMATI) ile paylaşmaz.
  const styled = renderFasonCekiHtml(
    makeSnap({
      doc: cmdDoc("MAVİ", [{ name: "APRE" }]),
      docConfigOverride: { fields: { cmdValue: { size: 22, weight: "black" } } },
    }),
  );
  check("fields.cmdValue talimat değerine uygulanır",
    rule(styled, ".sheet .cmd-val").includes("font-size: 22px"));
  check("fields.cmdValue FASON TALİMATI kutusuna DOKUNMAZ", !styled.includes(".sheet .instr-txt {"));

  // ⚠️ ÖNİZLEME = GERÇEK BASKI (§14b'nin kardeşi): örnek veri kutuyu taşımazsa
  // Belge Şablonları'nın canlı önizlemesi kutuyu göstermez, baskı gösterir.
  const sample = SAMPLE_PRINTED_DOCS.SUBCONTRACTOR_DISPATCH as {
    commands?: { color?: unknown; works?: unknown[] };
  };
  check("§14b-EK örnek veri talimat nesnesi taşır",
    typeof sample.commands?.color === "string" && (sample.commands?.works?.length ?? 0) > 0);
}

// ── 19) ELECTRON BÖLÜM AYNASI (2026-08-15) ─────────────────────────────────
// §16 `fields` aynasını denetliyordu; `sections` tarafının HİÇ bekçisi yoktu ve
// `sections` için GERÇEKTEN DEĞİŞEN TEK KAPI Electron'dur (üç backend kapısı da
// generic `Record<string, boolean>` taşır). Yani bir bölüm anahtarı backend'de
// çalışıp panelde hiç görünmeyebilir — ayar kaydedilir, baskıda etkisini gösterir,
// ama kimse açıp kapatamaz. Üç yönlü denetlenir: eksik · fazla · SEMANTİK.
function testElectronSectionMirror(): void {
  console.log("\n── 19) Electron bölüm (sections) aynası ──");
  const UI = path.resolve(__dirname, "../../Electron/src/services/documentConfig.ts");
  const ROWS = path.resolve(__dirname, "../../Electron/src/pages/GeneralSettings/docRows.ts");
  const RENDERER = path.resolve(__dirname, "../src/services/document-render/fason-ceki.html.ts");
  if (!fs.existsSync(UI) || !fs.existsSync(ROWS)) {
    console.log("  ⚠️  Electron kaynağı bulunamadı, bölüm aynası atlandı");
    return;
  }

  // Panel tarafı: DOC_DEFS → fasonSevk → sections[] (tek satırlık nesne kayıtları).
  const ui = fs.readFileSync(UI, "utf8");
  const fasonAt = ui.indexOf('key: "fasonSevk"');
  const secStart = ui.indexOf("sections: [", fasonAt);
  const secEnd = ui.indexOf("\n    ],", secStart);
  check("Electron fasonSevk.sections bloğu okunabildi", fasonAt > 0 && secStart > 0 && secEnd > secStart);
  if (fasonAt < 0 || secStart < 0 || secEnd < 0) return;
  const secBlock = ui.slice(secStart, secEnd);
  const uiSections = new Map<string, boolean>();
  for (const line of secBlock.split("\n")) {
    const m = /\{\s*key:\s*"(\w+)"/.exec(line);
    if (m) uiSections.set(m[1]!, /defaultHidden:\s*true/.test(line));
  }

  // Renderer tarafı: `cfg.sections?.X !== false` / `=== true` okuma noktaları.
  const rnd = fs.readFileSync(RENDERER, "utf8");
  const rendererOps = new Map<string, string>();
  for (const m of rnd.matchAll(/cfg\.sections\?\.(\w+)\s*(!==|===)\s*(false|true)/g)) {
    rendererOps.set(m[1]!, `${m[2]} ${m[3]}`);
  }

  // KÖRLÜK ZEMİNİ — regex bir refactor'da boşa düşerse "fark yok" ile "hiçbir
  // şeye bakılmadı" aynı yeşile çıkardı.
  check("panel bölüm listesi anlamlı büyüklükte (>10)", uiSections.size > 10, `${uiSections.size}`);
  check("renderer okuma noktası anlamlı büyüklükte (>9)", rendererOps.size > 9, `${rendererOps.size}`);

  const oluToggle = [...uiSections.keys()].filter((k) => !rendererOps.has(k));
  check("§19-1 ÖLÜ TOGGLE YOK (panelde var, renderer okumuyor)", oluToggle.length === 0, oluToggle.join(", "));
  const ayarlanamaz = [...rendererOps.keys()].filter((k) => !uiSections.has(k));
  check("§19-2 AYARLANAMAZ BÖLÜM YOK (renderer okuyor, panelde yok)",
    ayarlanamaz.length === 0, ayarlanamaz.join(", "));

  // ⚠️ EN KRİTİK: `defaultHidden` (allowlist) ↔ `=== true`, aksi (blocklist) ↔
  // `!== false`. Ayrışma SESSİZDİR ve iki yönü de kullanıcıyı çıkmaza sokar:
  // panel "açık" derken belge boş çıkar, ya da panel "kapalı" derken belge basar.
  const semantikDrift = [...uiSections.entries()]
    .filter(([k, hidden]) => rendererOps.get(k) !== (hidden ? "=== true" : "!== false"))
    .map(([k, hidden]) => `${k}(${hidden ? "allowlist" : "blocklist"}→${rendererOps.get(k)})`);
  check("§19-3 defaultHidden ↔ karşılaştırma operatörü hizalı",
    semantikDrift.length === 0, semantikDrift.join(", "));

  // Yeni bölümler gerçekten eklenmiş mi (bu işin kendi kilidi).
  check("dyeColorLine paneldedir ve BLOCKLIST'tir (varsayılan AÇIK)",
    uiSections.get("dyeColorLine") === false);
  check("instructionWarning paneldedir ve BLOCKLIST'tir",
    uiSections.get("instructionWarning") === false);

  // §19-5 PANEL GRUBU — yazılmazsa satır "eşleşmemiş bölüm" dalından gelir ve
  // varsayılanı `header`dır → kutu ayarı başlık bandının altında çıkar.
  const rows = fs.readFileSync(ROWS, "utf8");
  const grpAt = rows.indexOf("const SECTION_GROUP");
  const grpBlock = rows.slice(grpAt, rows.indexOf("\n};", grpAt));
  const fasonGrp = grpBlock.slice(grpBlock.indexOf("fasonSevk:"), grpBlock.indexOf("fasonDirectShip:"));
  check("§19-5 dyeColorLine 'boxes' grubunda", /dyeColorLine:\s*"boxes"/.test(fasonGrp));
  check("§19-5 instructionWarning 'boxes' grubunda", /instructionWarning:\s*"boxes"/.test(fasonGrp));
}

// ── 20) ADIM SÜZGECİ — "YAPILACAK İŞLEMLER" bu adımın işidir ───────────────
// Çeki BU SEVKİN gittiği ADIMIN işini anlatır; iş emrinin TÜM hedeflerini basmak
// "BOYANACAK RENK: EKRU" ile aynı sınıf bir yalandır. Şekli olan gerçek kayıt
// var: IE2207260001 hedefleri = YUMUŞAK TUŞE -1 + AÇMAZLIK + JET BOYA PİŞİRME +
// KURŞUNLU; KURŞUNLU yalnız "Kurşun + KK2" istasyonunun yeteneğidir.
type FakeDb = Parameters<typeof resolveStepWorkInstructions>[0];
function fakeDb(caps: string[], counter: { n: number }): FakeDb {
  return {
    stationProperty: {
      findMany: async () => {
        counter.n++;
        return caps.map((propertyId) => ({ propertyId }));
      },
    },
  } as unknown as FakeDb;
}

async function testStepFilter(): Promise<void> {
  console.log("\n── 20) Adım süzgeci (hedef ∩ istasyon yeteneği) ──");

  const targets = [
    { propertyId: "p-kursun", name: "KURŞUNLU" },
    { propertyId: "p-apre", name: "APRE" },
  ];
  const c1 = { n: 0 };
  const only = await resolveStepWorkInstructions(fakeDb(["p-apre"], c1), "st-boya", targets);
  check("§20-1 SIZINTI YOK — yalnız istasyonun yapabildiği iş döner",
    only.length === 1 && only[0]!.name === "APRE");

  const c2 = { n: 0 };
  const none = await resolveStepWorkInstructions(fakeDb(["p-zimpara"], c2), "st-boya", targets);
  check("§20-2 FAIL-CLOSED — kesişim boşsa BOŞ dizi (hepsini basan dal YOK)", none.length === 0);

  const c3 = { n: 0 };
  const empty = await resolveStepWorkInstructions(fakeDb(["p-apre"], c3), "st-boya", []);
  check("§20-3 hedef yoksa boş dizi VE sorgu KOŞMAZ", empty.length === 0 && c3.n === 0);
  check("§20-3 hedef varken sorgu bir kez koşar", c1.n === 1 && c2.n === 1);

  // Sıra deterministik ve TÜRKÇE — "İ"/"I" içeren adlarda da aynı sonuç.
  const caps = ["a", "b", "c"];
  const mixed = [
    { propertyId: "c", name: "IŞIL APRE" },
    { propertyId: "a", name: "AÇMAZLIK" },
    { propertyId: "b", name: "İNCE TUŞE" },
  ];
  const s1 = await resolveStepWorkInstructions(fakeDb(caps, { n: 0 }), "st", mixed);
  const s2 = await resolveStepWorkInstructions(fakeDb(caps, { n: 0 }), "st", [...mixed].reverse());
  check("§20-4 karışık sıra → aynı sonuç (localeCompare tr)",
    s1.map((w) => w.name).join("|") === s2.map((w) => w.name).join("|"), s1.map((w) => w.name).join("|"));
  check("§20-4 hepsi korunur (süzgeç yalnız yetenek dışını eler)", s1.length === 3);

  // ── §20-5..8 RENK DE ADIMA SÜZÜLÜR (2026-08-15 doğrulama turu) ────────────
  // İşlemler tarafına kurulan "bu adımın işini anlat" kuralı renk tarafında
  // YOKTU: `WorkOrder.targetColor` doğrudan basılıyordu. Canlıda `ZIMPARA`
  // kategorisi AKTİF ve `appliesColor=false` → rota Boyahane→Zımpara olduğunda
  // zımparacıya giden çekinin ÜZERİNDEKİ TEK TALİMAT "BOYANACAK RENK : MAVİ"
  // olurdu. Yüklem fason KABULÜYLE aynı (`!!step.requiredCategory?.appliesColor`)
  // — ayrışsalardı kâğıt "boya" derken kabul rengi hiç yazmazdı.
  const dye = { requiredCategory: { appliesColor: true } };
  const sander = { requiredCategory: { appliesColor: false } };
  check("§20-5 renk VEREN kategori (Boyahane) → talimat basılır",
    resolveStepDyeColor(dye, "MAVİ") === "MAVİ");
  check("§20-6 renk VERMEYEN kategori (Zımpara) → boya talimatı GİTMEZ",
    resolveStepDyeColor(sander, "MAVİ") === null);
  check("§20-7 kategorisiz adımda FAIL-CLOSED (kabul de renk kopyalamaz)",
    resolveStepDyeColor({}, "MAVİ") === null &&
      resolveStepDyeColor({ requiredCategory: null }, "MAVİ") === null);
  check("§20-8 hedef renk yoksa kategori fark etmez", resolveStepDyeColor(dye, null) === null);
}

async function main(): Promise<void> {
  testBasic();
  testGrid();
  testMultiPage();
  testFormatting();
  testWatermarks();
  testEscaping();
  testInstruction();
  testDocConfig();
  testColorFallback();
  testBatchNumber();
  testA4Fingerprint();
  testA5Density();
  testFieldStyles();
  testNewSections();
  testSingleWidth();
  testGridGroups();
  testCommandBox();
  testElectronMirror();
  testElectronSectionMirror();
  testPreviewSchemaParity();
  testStorageGate();
  await testStepFilter();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();

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
      workOrder: { id: "wo1", batchNumber: "P-260619-001", type: "STOCK_PRODUCTION" },
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
  check("metreler 115/100/83", html.includes(">115<") && html.includes(">100<") && html.includes(">83<"));
  check("en (cm) 150", html.includes(">150<"));
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
    makeSnap({ rolls: [roll(1, 100.5, 148), roll(2, 90, null)] }),
  );
  check("ondalık 100.5 korunur", html.includes(">100.5<"));
  check("tam sayı 90 ondalıksız", html.includes(">90<") && !html.includes(">90.0<"));
  check("yuvarlanan en 148", html.includes(">148<"));
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
  check("gridMetre CM'ye DOKUNMAZ", !metre.includes(".sheet .grid tbody .c-cm {"));

  const cm = renderFasonCekiHtml(makeSnap({ docConfigOverride: { fields: { gridCm: { size: 7 } } } }));
  check("gridCm ayrı ayarlanır", rule(cm, ".sheet .grid tbody .c-cm").includes("font-size: 7px"));
  check("gridCm METRE'ye DOKUNMAZ", !cm.includes(".sheet .grid tbody .c-met {"));

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
  check(
    "cins · en · renk TEK satırda, yan yana",
    fab.includes("PATOS, MUS-001 &nbsp;·&nbsp; 150, 140 cm &nbsp;·&nbsp; LACİVERT, SİYAH"),
  );
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
    !fabBlank.includes("150, 140 cm") && fabBlank.includes("PATOS, MUS-001"));

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
}

function main(): void {
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
  testGridGroups();
  testElectronMirror();
  testPreviewSchemaParity();
  testStorageGate();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();

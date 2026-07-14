// =============================================================================
// Test: kanvas eleman modeli → 4 dil emit (Etiket Stüdyosu F2)
// =============================================================================
// DB'siz sentetik test: degrade matrisi (PPLA'da line/box/banner atlanır),
// present:false alan atlanır (mutlak konum — diğer elemanlar KAYMAZ), rotasyon
// kodları, QR ölçeği, code128 human bayrağı, HTML mutlak konum + UTF-8,
// validateCanvasLayout kuralları, native-preview PPLA rot/QR-mag parse fix'i.
// Çalıştır: npx tsx scripts/test_label_canvas_renderer.ts
// =============================================================================
import {
  emitCanvasPpla,
  emitCanvasPplb,
  emitCanvasZpl,
  type CanvasRenderInput,
} from "../src/services/helpers/label-canvas-native.helper";
import { buildCanvasLabelHtml } from "../src/services/helpers/label-canvas-html.helper";
import {
  validateCanvasLayout,
  readCanvasLayout,
  CanvasValidationError,
  type CanvasLayout,
} from "../src/config/label-elements";
import { renderPplaToSvg } from "../src/services/helpers/native-preview";
import type { ResolvedLabelFormat } from "../src/services/helpers/label-format.resolver";
import type { LabelPayload } from "../src/services/label.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const format: ResolvedLabelFormat = {
  widthMm: 100, heightMm: 60, marginMm: 3,
  marginTopMm: 3, marginRightMm: 3, marginBottomMm: 3, marginLeftMm: 3, gapMm: 2,
  orientation: "LANDSCAPE" as never,
  dpi: 203, language: "PPLB" as never, source: "machine" as never,
};

const payload = {
  barcode: "TEKS20260706AB12", qualityGrade: "1.KALITE", widthCm: 150,
  lengthMeters: 320, weightKg: 40, itemName: "PATOS", colorName: "MAVİ",
  customerName: "Şahin Tekstil", batchNumber: "P-1",
} as unknown as LabelPayload;

const layout: CanvasLayout = {
  v: 1,
  elements: [
    { id: "qr", type: "qr", x: 3, y: 3, scale: 6 },
    { id: "t1", type: "field", bind: "itemName", x: 30, y: 3, font: "lg", bold: true },
    { id: "t2", type: "field", bind: "customerName", label: "Müşteri", x: 30, y: 12 },
    { id: "t3", type: "text", text: "SABİT NOT", x: 30, y: 20, rot: 90 },
    { id: "ln", type: "line", x: 3, y: 30, wMm: 90, hMm: 0.8 },
    { id: "bx", type: "box", x: 3, y: 32, wMm: 40, hMm: 10, thickMm: 1 },
    { id: "bn", type: "lengthBanner", x: 88, y: 3, wMm: 9, hMm: 50 },
    { id: "bc", type: "code128", x: 3, y: 46, hMm: 9, human: true },
  ],
};

function mk(input?: Partial<CanvasRenderInput>): CanvasRenderInput {
  return { payload, format, copies: 2, layout, ...input };
}

async function main() {
  const pplb = emitCanvasPplb(mk());
  const ppla = emitCanvasPpla(mk());
  const zpl = emitCanvasZpl(mk());
  const html = buildCanvasLabelHtml({ ...mk(), barcodeSvg: "<svg viewBox=\"0 0 10 10\"></svg>", qrSvg: "<svg viewBox=\"0 0 10 10\"></svg>" });

  // --- Degrade matrisi: PPLA'da YALNIZ banner yok (reverse yok); line/box artık
  //     DPL font-X kayıtlarıyla PPLA'da da basılır ---
  // Argox Line/Box: KÜÇÜK l/b = 4-haneli param (BÜYÜK L/B = 3-haneli → pad4 ile alan kayması/RESET).
  check("PPLA: line (Argox küçük 'l', 4-hane) basılır", /1X11000\d{4}\d{4}l\d{4}\d{4}/.test(ppla));
  check("PPLA: box (Argox küçük 'b', 4-hane) basılır", /1X11000\d{4}\d{4}b\d{4}\d{4}\d{4}\d{4}/.test(ppla));
  // Banner PPLA'da ÇERÇEVELİ basılır: band kutusu + 90° döndürülmüş siyah değer
  // (ters-renk yok — DPL reverse güvenilmez; dolgulu sürüm PPLB/ZPL'de).
  check(
    "PPLA: banner çerçeveli sürüm (kutu + rot-90 değer, ters-renksiz)",
    (ppla.match(/1X11000\d{4}\d{4}b/g) ?? []).length >= 2 && /^24\d\d000\d{8}320/m.test(ppla),
  );
  check("PPLB: line (LO) basılır", /LO24,240,719,6/.test(pplb));
  check("PPLB: box (X) basılır", /X24,256,8,344,336/.test(pplb) || /^X24,256,/m.test(pplb));
  // Bant: PPLB/ZPL SİYAH ZEMİN + BEYAZ değer (ters); PPLA çerçeveli (DPL reverse yok).
  check("PPLB: banner SİYAH+beyaz (ters R + boşluk dolgu)", /A775,56,1,4,3,3,R,"  320m  "/.test(pplb));
  check("ZPL: line dolu ^GB", /\^GB719,6,6,B/.test(zpl));
  check("ZPL: banner SİYAH+beyaz (dolu ^GB + ^FR ORTALANMIŞ değer)", /\^FO703,24\^GB72,400,72,B\^FS/.test(zpl) && /\^FO775,140\^A0R,72,42\^FR\^FD320m\^FS/.test(zpl));

  // --- Metin/rotasyon/font ---
  check("PPLB: bold metin çarpan 2", /A240,24,0,3,2,2,N,"PATOS"/.test(pplb));
  // PPLB Türkçe codepage (I8,E,001 + CP1254): asciiFold DEĞİL — Türkçe glif cp1254
  // baytına eşlenir (ü→ü, ş→þ, Ş→Þ) → yazıcı gerçek Türkçe basar. (commit 40b7c6f)
  check("PPLB: label'lı alan 'Müşteri: ...'", pplb.includes('"Müþteri: Þahin Tekstil"'));
  check("PPLB: rot 90 → rotCode 1", /A240,160,1,2,1,1,N,"SABÝT NOT"/.test(pplb));
  check("PPLA: rot 90 → önek 2", /^22\d\d000\d{4}\d{4}SABIT NOT/m.test(ppla));
  check("ZPL: rot 90 → ^A0R", /\^A0R,\d+,\d+\^FDSABIT NOT\^FS/.test(zpl));
  check("ZPL: bold ^A0N,40,24 (lg×2)", /\^A0N,40,24\^FDPATOS\^FS/.test(zpl));

  // --- QR / Code128 ---
  check("PPLB: QR s6", pplb.includes(`b24,24,Q,m2,s6,"${payload.barcode}"`));
  check("PPLA: QR 1W1d66 (auto QR, tek-karakter modül)", ppla.includes(`1W1d66`));
  check("ZPL: QR mag 6", zpl.includes("^BQN,2,6"));
  // Barkod okunur satırı: firmware KAPALI (N) + manuel, barkod ALTINDA ORTALANMIŞ
  // (barkod sol x=24 değil; PPLB hx=171 dot / PPLA hcol=0084 (171 dot → 1/100 inç) / ZPL hx=139).
  check("PPLB: Code128 human=N + ortalanmış (171)", /B24,368,0,1,2,3,72,N,/.test(pplb) && /A171,448,0,1,1,1,N,"TEKS20260706AB12"/.test(pplb));
  // PPLA birim: 1/100 inç + yükseklik alanı 3 HANE (fiziksel doğrulama 2026-07-10).
  check("PPLA: Code128 (h3) + okunur satır ORTALANMIŞ (0088, DPL font1 w=7)", /1e22\d{3}\d{4}\d{4}TEKS/.test(ppla) && /1111000\d{4}0088TEKS20260706AB12/.test(ppla));
  check("ZPL: Code128 interpretation=N + ortalanmış (139)", /\^BCN,72,N,N,N/.test(zpl) && /\^FO139,448\^A0N,20,12\^FDTEKS20260706AB12\^FS/.test(zpl) && !zpl.includes("^BY"));

  // --- ÇEVRİLEBİLİR bant: rot metin yönünü döndürür (varsayılan 90 dikey) ---
  const bnRot0: CanvasLayout = { v: 1, elements: [
    { id: "q9", type: "qr", x: 3, y: 40, scale: 4 },
    { id: "bn0", type: "lengthBanner", x: 30, y: 3, wMm: 40, hMm: 8, rot: 0 },
  ] };
  const pplbR0 = emitCanvasPplb(mk({ layout: bnRot0 }));
  const zplR0 = emitCanvasZpl(mk({ layout: bnRot0 }));
  const pplaR0 = emitCanvasPpla(mk({ layout: bnRot0 }));
  // rot=0 → PPLB rotCode 0, ZPL ^A0N, PPLA rot öneki 1 (yatay metin).
  check("bant rot=0: PPLB rotCode 0 (yatay)", /A\d+,\d+,0,4,\d,\d,R," *320m *"/.test(pplbR0));
  check("bant rot=0: ZPL ^A0N (yatay)", /\^A0N,\d+,\d+\^FR\^FD320m\^FS/.test(zplR0));
  check("bant rot=0: PPLA rot öneki 1 (yatay)", /14\d\d000\d{8}320/.test(pplaR0));
  // Varsayılan (rot yok) = 90 dikey — bayt-uyum (ana layout banner'ı).
  check("bant rot yok → 90 dikey (PPLB rotCode 1)", /A\d+,\d+,1,4,\d,\d,R,/.test(pplb));

  // --- SERBEST metin boyutu (hMm/wr): ZPL/HTML birebir, PPLA/PPLB en yakın kombinasyon ---
  const freeLayout: CanvasLayout = {
    v: 1,
    elements: [
      { id: "qr0", type: "qr", x: 3, y: 30, scale: 4 },
      { id: "big", type: "text", text: "KALIN", x: 3, y: 3, hMm: 6, wr: 2 },
    ],
  };
  const pplbFree = emitCanvasPplb(mk({ layout: freeLayout }));
  const pplaFree = emitCanvasPpla(mk({ layout: freeLayout }));
  const zplFree = emitCanvasZpl(mk({ layout: freeLayout }));
  const htmlFree = buildCanvasLabelHtml({ ...mk({ layout: freeLayout }), barcodeSvg: "<svg viewBox=\"0 0 1 1\"></svg>", qrSvg: "<svg viewBox=\"0 0 1 1\"></svg>" });
  // 6mm=48 dot → font5 (32×48) ×1 birebir; wr=2 → yatay çarpan 2.
  check("PPLB serbest: font5×(h2,v1) seçildi", /A24,24,0,5,2,1,N,"KALIN"/.test(pplbFree));
  check("PPLA serbest: 1 5 2 1 kaydı", /^1521000\d{8}KALIN/m.test(pplaFree));
  // ORTAK PAYDA: ZPL de PPLB/PPLA'nın seçtiği kombinasyonun boyutunu basar
  // (font5 h48 × hmul2 → w64) — dört dil AYNI boyut.
  check("ZPL serbest: ^A0N,48,64 (ortak kombinasyon)", /\^A0N,48,64\^FDKALIN\^FS/.test(zplFree));
  // 48 dot @203dpi = 6.006mm → HTML fiilen basılan boyutu yazar (6.01mm).
  check("HTML serbest: ortak kombinasyonun FİİLİ boyutu (≈6.01mm) + scaleX(2)", /font-size:6\.0\dmm/.test(htmlFree) && htmlFree.includes("scaleX(2)"));

  // --- Modül kalınlığı (mw): üç dilde orantılı genişletme ---
  const mwLayout: CanvasLayout = {
    v: 1,
    elements: [{ id: "bc3", type: "code128", x: 3, y: 10, hMm: 9, human: true, mw: 3 }],
  };
  const pplbMw = emitCanvasPplb(mk({ layout: mwLayout }));
  const pplaMw = emitCanvasPpla(mk({ layout: mwLayout }));
  const zplMw = emitCanvasZpl(mk({ layout: mwLayout }));
  check("PPLB: mw=3 → dar/geniş 3,4 (human firmware KAPALI)", /B24,80,0,1,3,4,72,N,/.test(pplbMw));
  check("PPLA: mw=3 → 1e33", /1e33\d{4}/.test(pplaMw));
  check("ZPL: mw=3 → ^BY3 (interpretation KAPALI)", zplMw.includes("^BY3^BCN,72,N,N,N"));

  // --- Medya komutları format profilinden ---
  check("PPLB: q/Q medya boyutu", pplb.includes("q799") && /Q480,16/.test(pplb));
  check("ZPL: ^PW/^LL", zpl.includes("^PW799") && zpl.includes("^LL480"));
  check("PPLA: STX M = TOF tavanı (gövde boyu değil; ≥5\" → 0500)", ppla.includes("\x02M0500"));
  check("kopya: P2 / Q0002 / ^PQ2", pplb.includes("P2") && ppla.includes("Q0002") && zpl.includes("^PQ2"));

  // --- present:false alan atlanır, DİĞER elemanlar kaymaz ---
  const noCust = { ...payload, customerName: null } as unknown as LabelPayload;
  const pplbNC = emitCanvasPplb(mk({ payload: noCust }));
  // PPLB cp1254: müşteri satırı "Müþteri: ..." baytıyla yazılır (asciiFold değil).
  check("present:false: müşteri satırı yok", !pplbNC.includes("Müþteri"));
  const linesWith = pplb.split("\r\n").filter((l) => !l.includes("Müþteri"));
  const linesWithout = pplbNC.split("\r\n");
  check("present:false: diğer satırlar BAYT-AYNI (kayma yok)", linesWith.join("|") === linesWithout.join("|"));

  // --- HTML: mutlak konum + UTF-8 (native'de asciiFold, HTML'de tam Türkçe) ---
  check("HTML: mutlak konum mm", html.includes("left:30mm") && html.includes("top:3mm"));
  // ORTAK PAYDA: HTML de native ile AYNI metni basar (Türkçe ASCII'ye katlanır)
  // — eleman dilden dile farklı çıktı vermez (kullanıcı kararı).
  check("HTML: metin native ile aynı (ASCII katlama)", html.includes("Sahin Tekstil") && html.includes("SABIT NOT") && !html.includes("Şahin"));
  check("HTML: @page medya boyutu", html.includes("size: 100mm 60mm"));
  check("HTML: kopya=2 sayfa", (html.match(/page-break-after/g) ?? []).length === 1);
  check("HTML: line/box div'leri", html.includes("background:#000") && html.includes("border:1mm solid #000"));

  // --- validateCanvasLayout kuralları ---
  const canvas = { widthMm: 100, heightMm: 60 };
  const okLayout = validateCanvasLayout(layout, canvas);
  check("validate: geçerli yerleşim kabul", okLayout.elements.length === layout.elements.length);
  const expectBad = (label: string, raw: unknown) => {
    try {
      validateCanvasLayout(raw, canvas);
      check(label, false, "hata beklenirdi");
    } catch (e) {
      check(label, e instanceof CanvasValidationError, e instanceof Error ? e.message : String(e));
    }
  };
  expectBad("validate: taranabilir alan zorunlu", { v: 1, elements: [{ id: "a", type: "text", text: "x", x: 1, y: 1 }] });
  expectBad("validate: tekrarlanan id red", { v: 1, elements: [
    { id: "a", type: "qr", x: 1, y: 1 }, { id: "a", type: "text", text: "x", x: 1, y: 1 },
  ] });
  expectBad("validate: tuval dışı x red", { v: 1, elements: [{ id: "a", type: "qr", x: 150, y: 1 }] });
  expectBad("validate: geçersiz font red", { v: 1, elements: [
    { id: "a", type: "qr", x: 1, y: 1 }, { id: "b", type: "text", text: "x", x: 1, y: 1, font: "xxl" },
  ] });
  expectBad("validate: bilinmeyen tip red", { v: 1, elements: [{ id: "a", type: "image", x: 1, y: 1 }] });
  check("readCanvasLayout: çöp → null", readCanvasLayout({ foo: 1 }) == null && readCanvasLayout(null) == null);
  check("readCanvasLayout: geçerli → layout", readCanvasLayout(layout)?.elements.length === layout.elements.length);

  // --- native-preview PPLA fix'leri: rot parse + QR mag komuttan ---
  const svg = renderPplaToSvg(ppla, 799);
  check("preview PPLA: SVG üretildi", !!svg);
  check("preview PPLA: rotasyonlu metin çizildi", !!svg && svg.includes("rotate(90"));
  // QR footprint = SEMBOL modülleri × mag (sessiz bölge kutuya EKLENMEZ — basılan kara
  // alan; beyaz sessiz bölge görsel boşluk kalır). 21 modül × 6 = 126.
  check("preview PPLA: QR boyutu mag=6'dan (sembol 21×6=126)", !!svg && svg.includes('width="126"'));
}

main()
  .then(() => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error("HATA:", e);
    process.exit(1);
  });

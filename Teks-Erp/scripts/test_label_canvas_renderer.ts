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
  dpi: 203, language: "PPLB" as never, profileId: "p1", source: "machine" as never,
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

  // --- Degrade matrisi: PPLA'da line/box/banner YOK; PPLB/ZPL'de VAR ---
  check("PPLA: line/box/banner atlanır", !ppla.includes("LO") && !/X\d+,\d+,\d+,/.test(ppla));
  check("PPLB: line (LO) basılır", /LO24,240,719,6/.test(pplb));
  check("PPLB: box (X) basılır", /X24,256,8,344,336/.test(pplb) || /^X24,256,/m.test(pplb));
  check("PPLB: banner ters metin (R) basılır", /,R,"/.test(pplb));
  check("ZPL: line dolu ^GB", /\^GB719,6,6,B/.test(zpl));
  check("ZPL: banner ^GB + ^FR", zpl.includes("^FR"));

  // --- Metin/rotasyon/font ---
  check("PPLB: bold metin çarpan 2", /A240,24,0,3,2,2,N,"PATOS"/.test(pplb));
  check("PPLB: label'lı alan 'Müşteri: ...'", pplb.includes('"Musteri: Sahin Tekstil"'));
  check("PPLB: rot 90 → rotCode 1", /A240,160,1,2,1,1,N,"SABIT NOT"/.test(pplb));
  check("PPLA: rot 90 → önek 2", /^22\d\d000\d{4}\d{4}SABIT NOT/m.test(ppla));
  check("ZPL: rot 90 → ^A0R", /\^A0R,\d+,\d+\^FDSABIT NOT\^FS/.test(zpl));
  check("ZPL: bold ^A0N,40,24 (lg×2)", /\^A0N,40,24\^FDPATOS\^FS/.test(zpl));

  // --- QR / Code128 ---
  check("PPLB: QR s6", pplb.includes(`b24,24,Q,m2,s6,"${payload.barcode}"`));
  check("PPLA: QR 1W1c0606", ppla.includes(`1W1c0606`));
  check("ZPL: QR mag 6", zpl.includes("^BQN,2,6"));
  check("PPLB: Code128 human=B", /B24,368,0,1,2,3,72,B,/.test(pplb));
  check("PPLA: Code128 + okunur satır", /1e22\d{4}\d{4}\d{4}TEKS/.test(ppla) && /1111000\d{8}TEKS/.test(ppla));
  check("ZPL: Code128 human=Y", /\^BCN,72,Y,N,N/.test(zpl));

  // --- Medya komutları format profilinden ---
  check("PPLB: q/Q medya boyutu", pplb.includes("q799") && /Q480,16/.test(pplb));
  check("ZPL: ^PW/^LL", zpl.includes("^PW799") && zpl.includes("^LL480"));
  check("PPLA: STX M yükseklik", ppla.includes("\x02M0480"));
  check("kopya: P2 / Q0002 / ^PQ2", pplb.includes("P2") && ppla.includes("Q0002") && zpl.includes("^PQ2"));

  // --- present:false alan atlanır, DİĞER elemanlar kaymaz ---
  const noCust = { ...payload, customerName: null } as unknown as LabelPayload;
  const pplbNC = emitCanvasPplb(mk({ payload: noCust }));
  check("present:false: müşteri satırı yok", !pplbNC.includes("Musteri"));
  const linesWith = pplb.split("\r\n").filter((l) => !l.includes("Musteri"));
  const linesWithout = pplbNC.split("\r\n");
  check("present:false: diğer satırlar BAYT-AYNI (kayma yok)", linesWith.join("|") === linesWithout.join("|"));

  // --- HTML: mutlak konum + UTF-8 (native'de asciiFold, HTML'de tam Türkçe) ---
  check("HTML: mutlak konum mm", html.includes("left:30mm") && html.includes("top:3mm"));
  check("HTML: UTF-8 korunur", html.includes("Şahin Tekstil") && html.includes("SABİT NOT"));
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
  check("preview PPLA: QR boyutu mag=6'dan (footprint (21+8)×6=174)", !!svg && svg.includes('width="174"'));
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

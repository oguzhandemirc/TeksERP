// =============================================================================
// Test: koşullu etiket elemanı (showIf) — "kaliteyi yalnız 2. kalitede bas"
// =============================================================================
// DB'siz sentetik test. Kapsam:
//   1. Doğrulama (validateCanvasLayout): geçerli koşul kabul, bozuk koşul RED.
//   2. Değerlendirme: in / notIn / kalitesiz top (fail-closed) / Türkçe-duyarlı
//      büyük harf toleransı.
//   3. DÖRT DİL + raster AYNI kararı verir — bir emitter `prepareElements`
//      yerine `expandMultilineText` çağırırsa koşul O DİLDE sessizce çalışmaz;
//      bu testin asıl varlık sebebi budur.
//   4. Koşulsuz şablon: çıktı bayt-bayt DEĞİŞMEZ (regresyon kapısı).
//   5. Kimlik guard'ı: koşullu `sackNo` alanı çuval kimliği SAYILMAZ.
// Çalıştır: npx tsx scripts/test_label_element_condition.ts
// =============================================================================
import {
  emitCanvasPpla,
  emitCanvasPplb,
  emitCanvasZpl,
  type CanvasRenderInput,
} from "../src/services/helpers/label-canvas-native.helper";
import { buildCanvasLabelHtml } from "../src/services/helpers/label-canvas-html.helper";
import { rasterizeCanvasLayout } from "../src/services/helpers/raster/raster-canvas";
import {
  validateCanvasLayout,
  elementConditionMet,
  prepareElements,
  CanvasValidationError,
  type CanvasLayout,
  type LabelElement,
} from "../src/config/label-elements";
import { analyzeContextFit } from "../src/services/helpers/label-context-fit";
import type { ResolvedLabelFormat } from "../src/services/helpers/label-format.resolver";
import type { LabelPayload } from "../src/services/label.service";
import { LabelKind } from "@prisma/client";

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

const SVG = '<svg viewBox="0 0 10 10"></svg>';

function payloadFor(qualityGrade: string): LabelPayload {
  return {
    barcode: "TEKS20260802AB12", qualityGrade, widthCm: 150,
    lengthMeters: 320, weightKg: 40, itemName: "PATOS", colorName: "MAVİ",
    customerName: "Şahin Tekstil", batchNumber: "P-1",
  } as unknown as LabelPayload;
}

/** Kalite alanı YALNIZ A1 (2. kalite) topunda basılır; ürün adı koşulsuz. */
const layout: CanvasLayout = {
  v: 1,
  elements: [
    { id: "qr", type: "qr", x: 3, y: 3, scale: 6 },
    { id: "urun", type: "field", bind: "itemName", x: 30, y: 3, hMm: 4 },
    {
      id: "kalite", type: "field", bind: "qualityGrade", label: "Kalite", x: 30, y: 14, hMm: 3,
      showIf: { field: "qualityGrade", op: "in", values: ["A1"] },
    },
    {
      id: "damga", type: "text", text: "IKINCI KALITE", x: 30, y: 24, hMm: 4,
      showIf: { field: "qualityGrade", op: "notIn", values: ["1.KALITE"] },
    },
  ],
};

function mk(qualityGrade: string): CanvasRenderInput {
  return { payload: payloadFor(qualityGrade), format, copies: 1, layout };
}

/** Bir elemanın çıktıda GÖRÜNÜP görünmediği — dört dil + raster için tek soru.
 *  Raster'da metin bitmap olduğu için "kaç eleman çizildi" ile ölçülemez →
 *  siyah piksel sayısı kıyaslanır (koşullu eleman düşünce piksel AZALIR). */
async function outputs(qualityGrade: string): Promise<{ pplb: string; ppla: string; zpl: string; html: string; ink: number }> {
  const input = mk(qualityGrade);
  const bmp = await rasterizeCanvasLayout(input);
  let ink = 0;
  for (const byte of bmp.data) ink += (byte.toString(2).match(/1/g) ?? []).length;
  return {
    pplb: emitCanvasPplb(input),
    ppla: emitCanvasPpla(input),
    zpl: await emitCanvasZpl(input),
    html: buildCanvasLabelHtml({ ...input, barcodeSvg: SVG, qrSvg: SVG }),
    ink,
  };
}

async function main() {
  // ---------------------------------------------------------------- 1. Doğrulama
  const okLayout = () => validateCanvasLayout(JSON.parse(JSON.stringify(layout)), { widthMm: 100, heightMm: 60 });
  let threw = "";
  try { okLayout(); } catch (e) { threw = (e as Error).message; }
  check("Geçerli koşul kabul edilir", threw === "", threw);

  const badCases: Array<[string, unknown]> = [
    ["field bilinmeyen", { field: "colorName", op: "in", values: ["A1"] }],
    ["op bilinmeyen", { field: "qualityGrade", op: "eq", values: ["A1"] }],
    ["values boş", { field: "qualityGrade", op: "in", values: [] }],
    ["values dizi değil", { field: "qualityGrade", op: "in", values: "A1" }],
    ["values boş metin", { field: "qualityGrade", op: "in", values: ["  "] }],
    ["showIf nesne değil", "A1"],
  ];
  for (const [name, showIf] of badCases) {
    const l = JSON.parse(JSON.stringify(layout)) as CanvasLayout;
    (l.elements[2] as LabelElement).showIf = showIf as never;
    let msg = "";
    try { validateCanvasLayout(l, { widthMm: 100, heightMm: 60 }); } catch (e) {
      msg = e instanceof CanvasValidationError ? e.message : `YANLIŞ HATA TİPİ: ${(e as Error).message}`;
    }
    check(`Bozuk koşul reddedilir (${name})`, msg.startsWith("'kalite'"), msg || "hata FIRLATILMADI");
  }

  // ------------------------------------------------------------ 2. Değerlendirme
  const kaliteEl = layout.elements[2] as LabelElement;
  const damgaEl = layout.elements[3] as LabelElement;
  check("in: eşleşen kalite → basılır", elementConditionMet(kaliteEl, { qualityGrade: "A1" }));
  check("in: eşleşmeyen kalite → basılmaz", !elementConditionMet(kaliteEl, { qualityGrade: "1.KALITE" }));
  check("in: küçük/büyük harf toleransı", elementConditionMet(kaliteEl, { qualityGrade: " a1 " }));
  check("notIn: listede olmayan kalite → basılır", elementConditionMet(damgaEl, { qualityGrade: "A1" }));
  check("notIn: listedeki kalite → basılmaz", !elementConditionMet(damgaEl, { qualityGrade: "1.KALITE" }));
  // FAIL-CLOSED: kalitesiz topta koşullu eleman HİÇBİR op ile basılmaz.
  check("kalitesiz top: in → basılmaz", !elementConditionMet(kaliteEl, { qualityGrade: "" }));
  check("kalitesiz top: notIn → basılmaz (fail-closed)", !elementConditionMet(damgaEl, { qualityGrade: null }));
  check("koşulsuz eleman daima basılır", elementConditionMet(layout.elements[1] as LabelElement, { qualityGrade: "" }));

  // Türkçe i/İ tuzağı: karşılaştırma YEREL-BAĞIMSIZ olmalı. `toLocaleUpperCase("tr")`
  // ile "1.kalite" → "1.KALİTE" (noktalı) olur ve katalogdaki "1.KALITE" ile
  // EŞLEŞMEZDİ — yani tolerans tam da Türkçe kodlarda sessizce kaybolurdu.
  const trEl: LabelElement = {
    id: "tr", type: "text", text: "x", x: 1, y: 1,
    showIf: { field: "qualityGrade", op: "in", values: ["1.kalite"] },
  };
  check("Harf toleransı yerel-bağımsız (Türkçe i/İ tuzağı yok)", elementConditionMet(trEl, { qualityGrade: "1.KALITE" }));

  // ------------------------------------------------- 3. Dört dil + raster AYNI karar
  const a1 = await outputs("A1");
  const k1 = await outputs("1.KALITE");

  check("PPLB: A1'de kalite basılır", a1.pplb.includes("A1"));
  check("PPLB: 1.KALITE'de kalite alanı YOK", !k1.pplb.includes("Kalite"));
  check("PPLA: A1'de kalite basılır", a1.ppla.includes("A1"));
  check("PPLA: 1.KALITE'de kalite alanı YOK", !k1.ppla.includes("Kalite"));
  check("ZPL: A1'de kalite basılır", a1.zpl.includes("A1"));
  check("ZPL: 1.KALITE'de kalite alanı YOK", !k1.zpl.includes("Kalite"));
  check("HTML: A1'de kalite basılır", a1.html.includes("Kalite: A1"));
  check("HTML: 1.KALITE'de kalite alanı YOK", !k1.html.includes("Kalite"));
  check("Raster: koşullu eleman düşünce mürekkep azalır", k1.ink < a1.ink, `A1=${a1.ink} · 1.KALITE=${k1.ink}`);

  // notIn damgası: 1.KALITE'de basılmaz, A1'de basılır (dört dilde de aynı).
  check("notIn damgası A1'de basılır (4 dil)",
    a1.pplb.includes("IKINCI") && a1.ppla.includes("IKINCI") && a1.zpl.includes("IKINCI") && a1.html.includes("IKINCI"));
  check("notIn damgası 1.KALITE'de basılmaz (4 dil)",
    !k1.pplb.includes("IKINCI") && !k1.ppla.includes("IKINCI") && !k1.zpl.includes("IKINCI") && !k1.html.includes("IKINCI"));

  // Kalitesiz top: iki koşullu eleman da düşer, koşulsuz ürün adı KALIR.
  const bos = await outputs("");
  check("Kalitesiz top: koşullular düşer, koşulsuz kalır",
    !bos.pplb.includes("IKINCI") && !bos.pplb.includes("Kalite") && bos.pplb.includes("PATOS"));

  // --------------------------------------------- 4. Koşulsuz şablon: çıktı DEĞİŞMEZ
  const plain: CanvasLayout = { v: 1, elements: layout.elements.slice(0, 2) };
  const plainIn = { payload: payloadFor("A1"), format, copies: 1, layout: plain };
  const before = emitCanvasPplb(plainIn);
  const after = emitCanvasPplb({ ...plainIn, payload: payloadFor("1.KALITE") });
  check("Koşulsuz şablon kaliteden bağımsız aynı çıktıyı verir", before === after);
  check("prepareElements koşulsuzda diziyi olduğu gibi geçirir",
    prepareElements(plain.elements, { qualityGrade: "" }).length === plain.elements.length);

  // ------------------------------------------ 5. Koşullu kimlik alanı SAYILMAZ (çuval)
  const sackTpl = (showIf?: unknown) => ({
    name: "Çuval",
    variants: [{
      elements: {
        v: 1,
        elements: [
          { id: "qr", type: "qr", x: 3, y: 3 },
          { id: "no", type: "field", bind: "sackNo", x: 20, y: 3, ...(showIf ? { showIf } : {}) },
        ],
      },
    }],
  });
  check("Koşulsuz sackNo → çuval şablonu geçerli", analyzeContextFit(sackTpl(), LabelKind.SACK).ok);
  const conditional = analyzeContextFit(
    sackTpl({ field: "qualityGrade", op: "in", values: ["A1"] }),
    LabelKind.SACK,
  );
  check("Koşullu sackNo kimlik sayılmaz → şablon reddedilir",
    !conditional.ok && conditional.reason === "missing-identity");

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

// Raster registry sözleşme testi (DB'siz): renderLabel encoding/bytes + shouldRasterize
// gating + rasterMode=false bayt-aynı + PPLA fallback + rawCode/varyantsız komut.
// Koş: npx tsx scripts/test_raster_contract.ts

import { PrinterLanguage, type LabelTemplate, type LabelTemplateVariant } from "@prisma/client";
import { renderLabel, shouldRasterize, renderedBytes, type LabelRenderInput } from "../src/services/helpers/label-renderer.registry";
import { emitCanvasPplb, type CanvasRenderInput } from "../src/services/helpers/label-canvas-native.helper";
import { readCanvasLayout } from "../src/config/label-elements";
import type { ResolvedLabelFormat } from "../src/services/helpers/label-format.resolver";
import type { LabelPayload } from "../src/services/label.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const format: ResolvedLabelFormat = {
  widthMm: 100, heightMm: 60, marginMm: 3,
  marginTopMm: 3, marginRightMm: 3, marginBottomMm: 3, marginLeftMm: 3, gapMm: 2,
  orientation: "LANDSCAPE" as never, dpi: 203, language: "PPLB" as never, source: "machine" as never,
};
const payload = {
  barcode: "TEKS20260706AB12", qualityGrade: "1.KALITE", widthCm: 150,
  lengthMeters: 320, itemName: "PATOS", colorName: "MAVİ", customerName: "Şahin Tekstil",
} as unknown as LabelPayload;
const layoutJson = {
  v: 1,
  elements: [
    { id: "qr", type: "qr", x: 3, y: 3, scale: 5 },
    { id: "f", type: "field", bind: "itemName", x: 25, y: 5, hMm: 4 },
    { id: "bc", type: "code128", x: 3, y: 46, hMm: 9 },
  ],
};
const variant = { elements: layoutJson } as unknown as LabelTemplateVariant;
const rawTemplate = { rawCode: { PPLB: "N\r\nq800\r\nA10,10,0,3,1,1,N,\"{{itemName}}\"\r\nP1\r\n" } } as unknown as LabelTemplate;

function mk(rasterMode: boolean, over?: Partial<LabelRenderInput>): LabelRenderInput {
  return { payload, template: null, variant, barcodeSvg: "", qrSvg: "", copies: 2, format, rasterMode, ...over };
}

// --- shouldRasterize gating (önizleme + baskı AYNI kararı) ---
check("shouldRasterize PPLB + rasterMode → true", shouldRasterize(PrinterLanguage.PPLB, mk(true)) === true);
check("shouldRasterize rasterMode=false → false", shouldRasterize(PrinterLanguage.PPLB, mk(false)) === false);
check("shouldRasterize RASTER_HTML → false", shouldRasterize(PrinterLanguage.RASTER_HTML, mk(true)) === false);
check("shouldRasterize rawCode dolu → false (uzman komutta)", shouldRasterize(PrinterLanguage.PPLB, mk(true, { template: rawTemplate })) === false);
check("shouldRasterize varyantsız → false (akış-modeli)", shouldRasterize(PrinterLanguage.PPLB, mk(true, { variant: null })) === false);

// --- renderLabel raster (PPLB) ---
{
  const r = renderLabel(PrinterLanguage.PPLB, mk(true));
  check("PPLB raster → encoding=binary", r.encoding === "binary");
  check("PPLB raster → content boş, bytes dolu", r.content === "" && !!r.bytes && r.bytes.length > 0);
  check("PPLB raster → bytes GW zarfı içerir", !!r.bytes && r.bytes.toString("latin1").includes("GW0,0"));
  check("renderedBytes(raster) = r.bytes", renderedBytes(r) === r.bytes);
}

// --- renderLabel komut (PPLB, rasterMode=false) BAYT-AYNI ---
{
  const r = renderLabel(PrinterLanguage.PPLB, mk(false));
  check("PPLB komut → encoding=text", r.encoding === "text");
  check("PPLB komut → content native (N ile başlar)", r.content.startsWith("N\r\n"));
  // Bayt-aynı: registry komut çıktısı = doğrudan emitCanvasPplb.
  const layout = readCanvasLayout(variant.elements)!;
  const direct = emitCanvasPplb({ payload, format, copies: 2, layout } as CanvasRenderInput);
  check("PPLB komut = emitCanvasPplb (bayt-aynı)", r.content === direct);
  check("renderedBytes(komut) = latin1(content)", renderedBytes(r).equals(Buffer.from(r.content, "latin1")));
}

// --- PPLA raster → envelope fırlatır → KOMUTA düşer (fallback) ---
{
  const r = renderLabel(PrinterLanguage.PPLA, mk(true));
  check("PPLA raster → komuta düşer (encoding=text)", r.encoding === "text");
  check("PPLA fallback → content native DPL komutu (STX)", r.content.includes("\x02") && r.content.length > 20);
}

// --- ZPL raster → binary (^GFA ASCII ama binary yolundan) ---
{
  const r = renderLabel(PrinterLanguage.ZPL, mk(true));
  check("ZPL raster → encoding=binary", r.encoding === "binary");
  check("ZPL raster → bytes ^GFA içerir", !!r.bytes && r.bytes.toString("latin1").includes("^GFA"));
}

// --- rawCode + rasterMode → KOMUT (uzman yolu asla rasterlenmez) ---
{
  const r = renderLabel(PrinterLanguage.PPLB, mk(true, { template: rawTemplate }));
  check("rawCode + rasterMode → encoding=text (komut)", r.encoding === "text");
  check("rawCode → yer-tutucu dolduruldu (PATOS)", r.content.includes("PATOS"));
}

// --- varyantsız + rasterMode → akış-modeli KOMUT ---
{
  const r = renderLabel(PrinterLanguage.PPLB, mk(true, { variant: null }));
  check("varyantsız + rasterMode → encoding=text (akış komutu)", r.encoding === "text");
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);

// =============================================================================
// Test: native komut → görsel SVG çeviriciler (PPLB + PPLA + ZPL).
// Otomatik üreticilerin çıktısını çizip geçerli SVG (metin + barkod/QR) üretiyor mu.
// Çalıştır: npx tsx scripts/test_native_preview.ts
// =============================================================================
import { PrinterLanguage } from "@prisma/client";
import { buildRollLabelPpla } from "../src/services/helpers/label-ppla.helper";
import { buildRollLabelPplb } from "../src/services/helpers/label-pplb.helper";
import { buildRollLabelZpl } from "../src/services/helpers/label-zpl.helper";
import { renderNativePreviewSvg } from "../src/services/helpers/native-preview";
import { mmToDots } from "../src/services/helpers/native-label.shared";
import { mockPayload } from "../src/services/helpers/label-rawcode";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const fmt = {
  widthMm: 100, heightMm: 50, marginMm: 3,
  marginTopMm: 3, marginRightMm: 3, marginBottomMm: 3, marginLeftMm: 3,
  gapMm: 2, dpi: 203, orientation: "LANDSCAPE", language: "PPLB", profileId: null, source: "system-default",
} as never;
const payload = mockPayload("ROLL_FINISHED" as never);
const wd = mmToDots(100, 203);
const good = (svg: string | null) => !!svg && svg.includes("<svg") && svg.includes("<text") && svg.includes("<image") && /viewBox="0 0 \d+ \d+"/.test(svg);

// PPLB (mevcut)
const svgB = renderNativePreviewSvg(PrinterLanguage.PPLB, buildRollLabelPplb({ payload, format: fmt, copies: 1, template: null }), wd);
check("PPLB otomatik → geçerli SVG (metin+barkod)", good(svgB));

// PPLA (yeni)
const ppla = buildRollLabelPpla({ payload, format: fmt, copies: 1, template: null });
const svgA = renderNativePreviewSvg(PrinterLanguage.PPLA, ppla, wd);
check("PPLA otomatik → geçerli SVG (metin+barkod)", good(svgA), svgA ? "" : "null döndü");
check("PPLA viewBox genişliği widthDots'tan (799)", !!svgA && svgA.includes(`viewBox="0 0 ${wd} `), svgA?.match(/viewBox="[^"]+"/)?.[0]);

// ZPL (yeni)
const zpl = buildRollLabelZpl({ payload, format: fmt, copies: 1, template: null });
const svgZ = renderNativePreviewSvg(PrinterLanguage.ZPL, zpl, wd);
check("ZPL otomatik → geçerli SVG (metin+barkod)", good(svgZ), svgZ ? "" : "null döndü");

// Geçersiz / boş → null (HTML/text'e düşer)
check("geçersiz PPLA (M yok) → null", renderNativePreviewSvg(PrinterLanguage.PPLA, "merhaba dunya", wd) === null);
check("geçersiz ZPL (PW/LL yok) → null", renderNativePreviewSvg(PrinterLanguage.ZPL, "^XA^FDselam^FS^XZ", wd) === null);
check("RASTER_HTML → null (görsel motoru yok)", renderNativePreviewSvg(PrinterLanguage.RASTER_HTML, "<div/>", wd) === null);

console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);

// Etiket Stüdyosu — barkod-altı kod (boyut/ortala/kaydır) + serbest-boyut KALIN
// (çift-vuruş) emit doğrulaması. Server GEREKMEZ — emit helper'ları doğrudan.
// `npx tsx scripts/test_label_canvas_human_bold.ts`.

import {
  emitCanvasPpla,
  emitCanvasPplb,
  emitCanvasZpl,
  type CanvasRenderInput,
} from "../src/services/helpers/label-canvas-native.helper";
import { buildCanvasLabelHtml } from "../src/services/helpers/label-canvas-html.helper";
import { mmToDots } from "../src/services/helpers/native-label.shared";
import type { CanvasLayout } from "../src/config/label-elements";
import type { ResolvedLabelFormat } from "../src/services/helpers/label-format.resolver";
import type { LabelPayload } from "../src/services/label.service";

let pass = 0, fail = 0;
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
const payload = { barcode: "TEKS20260706AB12", itemName: "PATOS" } as unknown as LabelPayload;
const d = (mm: number) => mmToDots(mm, 203);

function mk(elements: CanvasLayout["elements"]): CanvasRenderInput {
  return { payload, format, copies: 1, layout: { v: 1, elements }, barcodeSvg: "", qrSvg: "" } as CanvasRenderInput;
}
const html = (elements: CanvasLayout["elements"]) =>
  buildCanvasLabelHtml({ ...mk(elements), barcodeSvg: '<svg viewBox="0 0 10 10"></svg>', qrSvg: '<svg viewBox="0 0 10 10"></svg>' });

/** PPLB'de bir barkodun okunur (A) satırını çek: B...N,"bc" hemen SONRAKİ A satırı. */
function pplbHumanLine(pplb: string): string | null {
  const lines = pplb.split(/\r\n/);
  const bi = lines.findIndex((l) => /^B\d+,\d+,0,1,/.test(l));
  return bi >= 0 && lines[bi + 1]?.startsWith("A") ? lines[bi + 1] : null;
}

async function main() {
  const bc = payload.barcode;

  // --- 1) VARSAYILAN (humanHMm yok) = bayt-uyum: küçük font 1,1,1 ---
  const def = emitCanvasPplb(mk([{ id: "bc", type: "code128", x: 3, y: 46, hMm: 9, human: true }]));
  check("PPLB varsayılan okunur satır font 1,1,1 (bayt-uyum)", new RegExp(`A\\d+,\\d+,0,1,1,1,N,"${bc}"`).test(def));

  // --- 2) BOYUT (humanHMm=4) → ortak-payda büyük font (2,2,2), 1,1,1 DEĞİL ---
  const big = emitCanvasPplb(mk([{ id: "bc", type: "code128", x: 3, y: 46, hMm: 9, human: true, humanHMm: 4 }]));
  check("PPLB humanHMm=4 → büyük font 2,2,2", new RegExp(`A\\d+,\\d+,0,2,2,2,N,"${bc}"`).test(big));
  check("PPLB humanHMm=4 artık 1,1,1 DEĞİL", !new RegExp(`,0,1,1,1,N,"${bc}"`).test(big));

  // --- 3) ORTALAMA hâlâ geçerli: humanHMm büyüdükçe X yeniden ortalanır (küçülür) ---
  const defX = Number(pplbHumanLine(def)!.match(/^A(\d+),/)![1]);
  const bigX = Number(pplbHumanLine(big)!.match(/^A(\d+),/)![1]);
  check("büyük kod daha geniş → sol X ortalamada azalır", bigX < defX, `def=${defX} big=${bigX}`);

  // --- 4) KAYDIRMA (humanDx/humanDy) — ortalı konumdan tam d(mm) kadar iter ---
  const shifted = emitCanvasPplb(mk([{ id: "bc", type: "code128", x: 3, y: 46, hMm: 9, human: true, humanDx: 5, humanDy: 2 }]));
  const [, sx, sy] = pplbHumanLine(shifted)!.match(/^A(\d+),(\d+),/)!;
  const [, dx, dy] = pplbHumanLine(def)!.match(/^A(\d+),(\d+),/)!;
  check("humanDx=5 → X = ortalı + d(5)", Number(sx) === Number(dx) + d(5), `${dx}+${d(5)} → ${sx}`);
  check("humanDy=2 → Y = ortalı + d(2)", Number(sy) === Number(dy) + d(2), `${dy}+${d(2)} → ${sy}`);

  // --- 5) KALIN serbest boyut = ÇİFT-VURUŞ (aynı metin, +1 dot) 3 native dilde ---
  const boldEls: CanvasLayout["elements"] = [
    { id: "sc", type: "qr", x: 3, y: 3, scale: 5 }, // taranabilir alan zorunlu
    { id: "tb", type: "text", text: "BOLD", x: 10, y: 10, hMm: 5, bold: true },
    { id: "tp", type: "text", text: "PLAIN", x: 10, y: 20, hMm: 5 },
  ];
  const pplb = emitCanvasPplb(mk(boldEls));
  const ppla = emitCanvasPpla(mk(boldEls));
  const zpl = emitCanvasZpl(mk(boldEls));
  const bx = d(10);
  check("PPLB kalın = 2 satır (x, x+1)", new RegExp(`A${bx},80,0,3,2,2,N,"BOLD"`).test(pplb) && new RegExp(`A${bx + 1},80,0,3,2,2,N,"BOLD"`).test(pplb));
  check("PPLB kalın DEĞİL = tek satır (x+1 yok)", (pplb.match(/N,"PLAIN"/g) || []).length === 1);
  check("ZPL kalın = 2 satır ^FO(x)/(x+1)", new RegExp(`\\^FO${bx},80\\^A0N,40,24\\^FDBOLD`).test(zpl) && new RegExp(`\\^FO${bx + 1},80\\^A0N,40,24\\^FDBOLD`).test(zpl));
  // PPLA serbest-boyut DPL taban fontuyla seçilir: hedef 5mm(40dot) → font1×3=39 → "1133".
  check("PPLA kalın = 2 satır (col, col+1)", (ppla.match(/1133000\d{4}\d{4}BOLD/g) || []).length === 2);

  // --- 6) HTML: human font-size = humanHMm, kaydırma translate, kalın font-weight ---
  const hDef = html([{ id: "bc", type: "code128", x: 3, y: 46, hMm: 9, human: true }]);
  const hBig = html([{ id: "bc", type: "code128", x: 3, y: 46, hMm: 9, human: true, humanHMm: 4, humanDx: 5, humanDy: 2 }]);
  check("HTML varsayılan human font 1.5mm", hDef.includes("font-size:1.5mm"));
  check("HTML humanHMm=4 → font 4mm + translate(5mm,2mm)", hBig.includes("font-size:4mm") && hBig.includes("translate(5mm,2mm)"));
  const hBold = html([{ id: "sc", type: "qr", x: 3, y: 3, scale: 5 }, { id: "tb", type: "text", text: "BOLD", x: 10, y: 10, hMm: 5, bold: true }]);
  check("HTML kalın = font-weight:bold", hBold.includes("font-weight:bold"));

  // --- 7) İKİ BAĞIMSIZ NESNE: çubuklar (code128 human:false) + ayrı field(barcode) ---
  const pair = emitCanvasPplb(mk([
    { id: "bars", type: "code128", x: 3, y: 40, hMm: 9, mw: 2, human: false },
    { id: "codetext", type: "field", bind: "barcode", label: "", x: 10, y: 51, hMm: 3 },
  ]));
  check("çubuklar: B komutunda barkod değeri", new RegExp(`^B\\d+,\\d+,0,1,2,3,\\d+,N,"${bc}"`, "m").test(pair));
  const aWithBc = (pair.match(new RegExp(`^A[^\\n]*N,"${bc}"`, "mg")) || []).length;
  check("human:false → gömülü A kod satırı YOK; ayrı field TEK A üretir", aWithBc === 1);
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(() => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  });

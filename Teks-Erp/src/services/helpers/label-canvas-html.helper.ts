// =============================================================================
// Kanvas eleman modeli → HTML emit (RASTER_HTML / ev-tipi & OS-sürücülü yazıcı)
// =============================================================================
// Varyant tuvalini position:absolute mm koordinatlarıyla HTML'e derler — kanvaslı
// şablonun HTML çıktısı native yerleşimle AYNI düzendedir (bilinçli sapma: eski
// el-kodlu portrait/landscape iskeletler yalnız şablonsuz/varyantsız fallback'te).
// Sayfa boyutu FORMAT profilinden (medya), eleman koordinatları VARYANTTAN.
// HTML tarafı native'den zengindir: gerçek bold + tam UTF-8 (asciiFold yok).
// =============================================================================

import type { CanvasRenderInput } from "./label-canvas-native.helper";
import { fieldDisplayValue } from "./label-field-values";
import { escapeHtml, applyCopies } from "./label-html.shared";
import { asciiFold, qrFootprintDots, resolveEplTextStyle, EPL_FONT } from "./native-label.shared";
import type { FieldElement, TextElement } from "../../config/label-elements";
import { elementSupported } from "../../config/label-elements";

export interface CanvasHtmlInput extends CanvasRenderInput {
  /** bwip-js Code128 SVG (ham). */
  barcodeSvg: string;
  /** bwip-js QR SVG (ham). */
  qrSvg: string;
}

// ORTAK PAYDA (kullanıcı kararı: eleman dilden dile FARKLI çıktı vermemeli):
// HTML metni de native ile aynı davranır — Türkçe ASCII'ye katlanır, monospace
// (yazıcı hücre modeli) kullanılır ve boyut native'in seçtiği kombinasyonun
// FİİLEN basılan yüksekliğidir (serbest mm değil). Kalınlık görünümünü genişlik
// oranı (wr) verir — font-weight parite dışı bırakıldı.
function textDiv(el: FieldElement | TextElement, content: string, dpi: number): string {
  const dotsPerMm = (dpi || 203) / 25.4;
  let hDots: number;
  let scaleX = 1;
  if (el.hMm != null) {
    const st = resolveEplTextStyle(el.hMm * dotsPerMm, el.wr ?? 1, 6);
    hDots = st.hDots;
    scaleX = st.hmul / st.vmul; // yatay/dikey çarpan farkı = dar/geniş görünüm
  } else {
    const f = EPL_FONT[el.font ?? "md"] ?? EPL_FONT.md;
    hDots = f.h * (el.bold ? 2 : 1);
  }
  const fontMm = hDots / dotsPerMm;
  const parts = [
    "position:absolute",
    `left:${el.x}mm`,
    `top:${el.y}mm`,
    `font-size:${fontMm.toFixed(2)}mm`,
    "font-family:'Courier New',monospace",
    "white-space:nowrap",
    "line-height:1",
  ];
  const transforms: string[] = [];
  if (el.rot) transforms.push(`rotate(${el.rot}deg)`);
  if (scaleX !== 1) transforms.push(`scaleX(${scaleX})`);
  if (transforms.length > 0) {
    parts.push(`transform:${transforms.join(" ")}`, "transform-origin:top left");
  }
  return `<div style="${parts.join(";")}">${escapeHtml(asciiFold(content))}</div>`;
}

export function buildCanvasLabelHtml(input: CanvasHtmlInput): string {
  const { payload, format, layout, copies, barcodeSvg, qrSvg } = input;
  const dotsPerMm = (format.dpi || 203) / 25.4;
  const els: string[] = [];

  for (const el of layout.elements) {
    if (!elementSupported(el.type, "RASTER_HTML")) continue;
    switch (el.type) {
      case "field":
      case "text": {
        const content =
          el.type === "text"
            ? el.text
            : (() => {
                const dv = fieldDisplayValue(payload, el.bind);
                if (!dv.present) return null;
                const label = el.label?.trim();
                return label ? `${label}: ${dv.value}` : dv.value;
              })();
        if (content) els.push(textDiv(el, content, format.dpi));
        break;
      }
      case "qr": {
        if (!payload.barcode || !qrSvg) break;
        const sizeMm = qrFootprintDots(payload.barcode.length, el.scale ?? 5) / dotsPerMm;
        els.push(
          `<div style="position:absolute;left:${el.x}mm;top:${el.y}mm;width:${sizeMm.toFixed(1)}mm;height:${sizeMm.toFixed(1)}mm">` +
            `<div style="width:100%;height:100%">${qrSvg.replace("<svg ", '<svg style="width:100%;height:100%" ')}</div></div>`,
        );
        break;
      }
      case "code128": {
        if (!payload.barcode || !barcodeSvg) break;
        const h = el.hMm ?? 9;
        const human = el.human !== false;
        // Modül kalınlığı: native'de dar-çubuk dot'u — HTML'de eşdeğeri yatay
        // orantılı ölçek (mw=2 taban; vektör olduğundan okunabilirlik bozulmaz).
        const scaleX = (el.mw ?? 2) / 2;
        const inner =
          `<div style="height:${h}mm">${barcodeSvg.replace("<svg ", `<svg style="height:${h}mm;width:auto" `)}</div>` +
          (human
            ? `<div style="font-family:'Courier New',monospace;font-size:1.5mm;letter-spacing:0.12em;text-align:center">${escapeHtml(payload.barcode)}</div>`
            : "");
        els.push(
          `<div style="position:absolute;left:${el.x}mm;top:${el.y}mm${
            scaleX !== 1 ? `;transform:scaleX(${scaleX});transform-origin:top left` : ""
          }">${inner}</div>`,
        );
        break;
      }
      case "line":
        els.push(
          `<div style="position:absolute;left:${el.x}mm;top:${el.y}mm;width:${el.wMm}mm;height:${el.hMm}mm;background:#000"></div>`,
        );
        break;
      case "box":
        els.push(
          `<div style="position:absolute;left:${el.x}mm;top:${el.y}mm;width:${el.wMm}mm;height:${el.hMm}mm;border:${el.thickMm ?? 0.5}mm solid #000;box-sizing:border-box"></div>`,
        );
        break;
      case "lengthBanner": {
        // SİYAH ZEMİN / BEYAZ DEĞER — dolgulu siyah kutu + beyaz döndürülmüş değer
        // (PPLB/ZPL ile aynı görünüm). Glif yüksekliği native ile aynı: xl(24 dot)
        // × band-genişliği çarpanı.
        const dv = fieldDisplayValue(payload, "lengthMeters");
        if (!dv.present) break;
        const w = el.wMm ?? 10;
        const h = el.hMm ?? Math.max(10, format.heightMm - 2 * el.y);
        const dotsPerMm = (format.dpi || 203) / 25.4;
        const mul = Math.max(1, Math.min(4, Math.round((w * dotsPerMm) / 24)));
        const glyphMm = (24 * mul) / dotsPerMm;
        const val = asciiFold(String(payload.lengthMeters));
        els.push(
          `<div style="position:absolute;left:${el.x}mm;top:${el.y}mm;width:${w}mm;height:${h}mm;background:#000;color:#fff;display:flex;align-items:center;justify-content:center">` +
            `<span style="transform:rotate(90deg);font-family:'Courier New',monospace;font-size:${glyphMm.toFixed(2)}mm;line-height:1;white-space:nowrap">${escapeHtml(val)}</span></div>`,
        );
        break;
      }
    }
  }

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Etiket ${escapeHtml(payload.barcode ?? "")}</title>
<style>
  @page { size: ${format.widthMm}mm ${format.heightMm}mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #fff; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; }
  .label { position: relative; width: ${format.widthMm}mm; height: ${format.heightMm}mm; overflow: hidden; }
  @media print { .label { page-break-inside: avoid; } }
</style>
</head>
<body>
<div class="label">
${els.join("\n")}
</div>
</body>
</html>`;

  return applyCopies(html, copies);
}

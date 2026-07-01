// =============================================================================
// Native komut → görsel SVG önizleme (WYSIWYG: "gördüğün = basılan")
// =============================================================================
// Yazıcıya giden PPLB (EPL2) komutlarını AYNEN görsele çevirir → önizleme, ayrı bir
// HTML motoru yerine gerçek baskı çıktısını gösterir; PPLB üreticisi değişince
// önizleme otomatik takip eder. Şimdilik PPLB; PPLA/ZPL çizici sonra eklenecek.
// Koordinatlar dot (203dpi) — SVG viewBox = q × Q.
// =============================================================================

import bwipjs from "bwip-js";
import { PrinterLanguage } from "@prisma/client";

// EPL2 font (1..5) → yaklaşık karakter yüksekliği (dot). vMul ile çarpılır.
const EPL_FONT_H: Record<string, number> = { "1": 12, "2": 16, "3": 20, "4": 25, "5": 47 };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** bwip-js barkod/QR'ı data-URI + intrinsic boyut olarak döner (embed için). */
function bwipImg(opts: Record<string, unknown>): { uri: string; w: number; h: number } | null {
  try {
    const svg = bwipjs.toSVG(opts as never);
    const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const w = vb ? parseFloat(vb[1]) : 1;
    const h = vb ? parseFloat(vb[2]) : 1;
    return { uri: "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64"), w, h };
  } catch {
    return null;
  }
}

/** PPLB/EPL2 komutlarını görsel SVG'ye çevir. Boyut (q/Q) yoksa null. */
export function renderPplbToSvg(pplb: string): string | null {
  const lines = pplb.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let W = 0, H = 0;
  const els: string[] = [];
  for (const ln of lines) {
    let m: RegExpMatchArray | null;
    if ((m = ln.match(/^q(\d+)/))) { W = +m[1]; continue; }
    if ((m = ln.match(/^Q(\d+)/))) { H = +m[1]; continue; }

    // Metin: A x,y,rot,font,hMul,vMul,rev(N/R),"veri"
    if ((m = ln.match(/^A(\d+),(\d+),\d+,(\d+),(\d+),(\d+),([NR]),"(.*)"$/))) {
      const [, x, y, font, hMul, vMul, rev, text] = m;
      const fs = (EPL_FONT_H[font] ?? 16) * (+vMul || 1);
      const cw = fs * 0.62 * ((+hMul || 1) / (+vMul || 1));
      const tw = esc(text).length * cw;
      if (rev === "R") els.push(`<rect x="${+x - 2}" y="${+y - 2}" width="${tw + 6}" height="${fs + 4}" fill="#000"/>`);
      els.push(
        `<text x="${+x + 2}" y="${y}" font-family="'Courier New',monospace" font-size="${fs.toFixed(1)}" font-weight="700" dominant-baseline="hanging" fill="${rev === "R" ? "#fff" : "#000"}">${esc(text)}</text>`,
      );
      continue;
    }
    // QR: b x,y,Q,m<n>,s<mag>,"veri"
    if ((m = ln.match(/^b(\d+),(\d+),Q,m\d+,s(\d+),"(.*)"$/))) {
      const [, x, y, s, data] = m;
      const img = bwipImg({ bcid: "qrcode", text: data, scale: 1, backgroundcolor: "ffffff" });
      if (img) {
        const size = img.w * (+s || 1);
        els.push(`<image href="${img.uri}" x="${x}" y="${y}" width="${size.toFixed(0)}" height="${size.toFixed(0)}"/>`);
      }
      continue;
    }
    // Barkod: B x,y,rot,type,narrow,wide,height,human(B/N),"veri" (type 1 = Code128)
    if ((m = ln.match(/^B(\d+),(\d+),\d+,\d+,\d+,\d+,(\d+),([BN]),"(.*)"$/))) {
      const [, x, y, height, human, data] = m;
      const img = bwipImg({ bcid: "code128", text: data, scale: 2, height: 10, includetext: false, backgroundcolor: "ffffff" });
      if (img) {
        const hh = +height;
        const ww = hh * (img.w / img.h);
        els.push(`<image href="${img.uri}" x="${x}" y="${y}" width="${ww.toFixed(0)}" height="${hh}"/>`);
        if (human === "B") {
          els.push(`<text x="${+x + ww / 2}" y="${+y + hh + 4}" font-family="'Courier New',monospace" font-size="18" text-anchor="middle" dominant-baseline="hanging" fill="#000">${esc(data)}</text>`);
        }
      }
      continue;
    }
    // Dolu siyah çizgi/kutu: LO x,y,w,h
    if ((m = ln.match(/^LO(\d+),(\d+),(\d+),(\d+)$/))) {
      const [, x, y, w, h] = m;
      els.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000"/>`);
      continue;
    }
    // Kutu çerçeve: X x1,y1,kalınlık,x2,y2
    if ((m = ln.match(/^X(\d+),(\d+),(\d+),(\d+),(\d+)$/))) {
      const [, x1, y1, t, x2, y2] = m;
      els.push(`<rect x="${x1}" y="${y1}" width="${+x2 - +x1}" height="${+y2 - +y1}" fill="none" stroke="#000" stroke-width="${t}"/>`);
      continue;
    }
    // N, D, S, P vb. — çizim üretmez, atla.
  }
  if (!W || !H) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>${els.join("")}</svg>`;
}

/** Aktif dile göre görsel önizleme SVG'si. Çizicisi olmayan dil → null (HTML'e düş). */
export function renderNativePreviewSvg(language: PrinterLanguage, native: string): string | null {
  if (language === PrinterLanguage.PPLB) return renderPplbToSvg(native);
  // TODO: PPLA (DPL) + ZPL çizicileri sonra.
  return null;
}

/** Görsel SVG'yi ekranda ortalayıp sığdıran HTML kabuk (iframe içeriği). */
export function svgToPreviewHtml(svg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
html{background:#eef2f7}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:12px}
svg{background:#fff;box-shadow:0 2px 12px rgba(15,23,42,0.18);max-width:100%;height:auto}
</style></head><body>${svg}</body></html>`;
}

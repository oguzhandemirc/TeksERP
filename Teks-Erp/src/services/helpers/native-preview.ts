// =============================================================================
// Native komut → görsel SVG önizleme (WYSIWYG: "gördüğün = basılan")
// =============================================================================
// Yazıcıya giden native komutları (PPLB/EPL2, PPLA/DPL, ZPL) AYNEN görsele çevirir
// → önizleme, ayrı bir HTML motoru yerine gerçek baskı çıktısını gösterir; üretici
// değişince önizleme otomatik takip eder. Koordinatlar dot (203dpi). SVG viewBox =
// baskı-genişliği × baskı-yüksekliği (dot).
// =============================================================================

import bwipjs from "bwip-js";
import { PrinterLanguage } from "@prisma/client";

// Bit-eşlem font kodu (1..5) → yaklaşık karakter yüksekliği (dot). Çarpanla ölçeklenir.
const FONT_H: Record<string, number> = { "1": 12, "2": 16, "3": 20, "4": 25, "5": 47 };

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

// --- Ortak çizim yardımcıları (üç dil paylaşır) — native metin üstten hizalı (hanging) ---
function svgText(x: number, y: number, fs: number, data: string, o?: { rev?: boolean; anchor?: string }): string {
  const anchor = o?.anchor ? ` text-anchor="${o.anchor}"` : "";
  return `<text x="${x}" y="${y}" font-family="'Courier New',monospace" font-size="${fs.toFixed(1)}" font-weight="700" dominant-baseline="hanging"${anchor} fill="${o?.rev ? "#fff" : "#000"}">${esc(data)}</text>`;
}
function svgQr(x: number, y: number, mag: number, data: string): string {
  const img = bwipImg({ bcid: "qrcode", text: data, scale: 1, backgroundcolor: "ffffff" });
  if (!img) return "";
  const size = img.w * (mag || 1);
  return `<image href="${img.uri}" x="${x}" y="${y}" width="${size.toFixed(0)}" height="${size.toFixed(0)}"/>`;
}
function svgBarcode(x: number, y: number, heightDots: number, data: string, human: boolean): string {
  const img = bwipImg({ bcid: "code128", text: data, scale: 2, height: 10, includetext: false, backgroundcolor: "ffffff" });
  if (!img) return "";
  const ww = heightDots * (img.w / img.h);
  let out = `<image href="${img.uri}" x="${x}" y="${y}" width="${ww.toFixed(0)}" height="${heightDots}"/>`;
  if (human) out += svgText(x + ww / 2, y + heightDots + 4, 18, data, { anchor: "middle" });
  return out;
}
function wrapSvg(W: number, H: number, els: string[]): string | null {
  if (!W || !H) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>${els.join("")}</svg>`;
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
      const fs = (FONT_H[font] ?? 16) * (+vMul || 1);
      if (rev === "R") {
        const tw = esc(text).length * fs * 0.62 * ((+hMul || 1) / (+vMul || 1));
        els.push(`<rect x="${+x - 2}" y="${+y - 2}" width="${(tw + 6).toFixed(0)}" height="${fs + 4}" fill="#000"/>`);
      }
      els.push(svgText(+x + 2, +y, fs, text, { rev: rev === "R" }));
      continue;
    }
    // QR: b x,y,Q,m<n>,s<mag>,"veri"
    if ((m = ln.match(/^b(\d+),(\d+),Q,m\d+,s(\d+),"(.*)"$/))) {
      els.push(svgQr(+m[1], +m[2], +m[3], m[4]));
      continue;
    }
    // Barkod: B x,y,rot,type,narrow,wide,height,human(B/N),"veri" (type 1 = Code128)
    if ((m = ln.match(/^B(\d+),(\d+),\d+,\d+,\d+,\d+,(\d+),([BN]),"(.*)"$/))) {
      els.push(svgBarcode(+m[1], +m[2], +m[3], m[5], m[4] === "B"));
      continue;
    }
    // Dolu siyah çizgi/kutu: LO x,y,w,h
    if ((m = ln.match(/^LO(\d+),(\d+),(\d+),(\d+)$/))) {
      els.push(`<rect x="${m[1]}" y="${m[2]}" width="${m[3]}" height="${m[4]}" fill="#000"/>`);
      continue;
    }
    // Kutu çerçeve: X x1,y1,kalınlık,x2,y2
    if ((m = ln.match(/^X(\d+),(\d+),(\d+),(\d+),(\d+)$/))) {
      els.push(`<rect x="${m[1]}" y="${m[2]}" width="${+m[4] - +m[1]}" height="${+m[5] - +m[2]}" fill="none" stroke="#000" stroke-width="${m[3]}"/>`);
      continue;
    }
    // N, D, S, P vb. — çizim üretmez, atla.
  }
  return wrapSvg(W, H, els);
}

/** PPLA/Datamax-DPL komutlarını görsel SVG'ye çevir. Genişlik komutta YOK → widthDots'tan.
 *  Satırlar CR-ayrık; koordinat row=y, col=x (4 hane dot). */
export function renderPplaToSvg(ppla: string, widthDots: number): string | null {
  const lines = ppla.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  const W = widthDots || 799;
  let H = 0;
  const els: string[] = [];
  for (const ln of lines) {
    let m: RegExpMatchArray | null;
    // Yükseklik: <STX>M#### (max label length)
    if ((m = ln.match(/^\x02?M(\d+)$/))) { H = +m[1]; continue; }
    // QR: 1W1c0606<row4><col4><veri>  (metin regex'inden ÖNCE — "1W" ile başlar)
    if ((m = ln.match(/^1W1c\d{4}(\d{4})(\d{4})(.*)$/))) {
      els.push(svgQr(+m[2], +m[1], 4, m[3]));
      continue;
    }
    // Code128: 1e<n><w><h4><row4><col4><veri>
    if ((m = ln.match(/^1e\d\d(\d{4})(\d{4})(\d{4})(.*)$/))) {
      els.push(svgBarcode(+m[3], +m[2], +m[1], m[4], false));
      continue;
    }
    // Metin: 1<font><wMul><hMul>000<row4><col4><veri>
    if ((m = ln.match(/^1([1-9])(\d)(\d)000(\d{4})(\d{4})(.*)$/))) {
      const fs = (FONT_H[m[1]] ?? 20) * (+m[3] || 1);
      els.push(svgText(+m[5], +m[4], fs, m[6]));
      continue;
    }
    // <STX>n, <STX>L, D11, H10, Q####, E — çizim üretmez, atla.
  }
  return wrapSvg(W, H, els);
}

/** ZPL komutlarını görsel SVG'ye çevir. Alanlar satır-içi de olabilir → global regex. */
export function renderZplToSvg(zpl: string): string | null {
  let m = zpl.match(/\^PW(\d+)/);
  const W = m ? +m[1] : 0;
  m = zpl.match(/\^LL(\d+)/);
  const H = m ? +m[1] : 0;
  const els: string[] = [];
  // Metin: ^FO x,y^A0N,h,w^FD veri^FS
  for (const t of zpl.matchAll(/\^FO(\d+),(\d+)\^A0N,(\d+),(\d+)\^FD([\s\S]*?)\^FS/g)) {
    els.push(svgText(+t[1], +t[2], +t[3], t[5]));
  }
  // QR: ^FO x,y^BQN,model,mag^FDQA,veri^FS ("QA," öneki sıyrılır)
  for (const q of zpl.matchAll(/\^FO(\d+),(\d+)\^BQN,\d+,(\d+)\^FD(?:QA,)?([\s\S]*?)\^FS/g)) {
    els.push(svgQr(+q[1], +q[2], +q[3] || 3, q[4]));
  }
  // Code128: ^FO x,y^BCN,h,Y,...^FD veri^FS  (Y = okunur satır yazıcıda çizilir → biz de)
  for (const b of zpl.matchAll(/\^FO(\d+),(\d+)\^BCN,(\d+),([^,^]*),[^^]*\^FD([\s\S]*?)\^FS/g)) {
    els.push(svgBarcode(+b[1], +b[2], +b[3], b[5], b[4] === "Y"));
  }
  // Kutu/çizgi: ^FO x,y^GB w,h,t^FS (üretici emit etmez; uzman kodu için)
  for (const g of zpl.matchAll(/\^FO(\d+),(\d+)\^GB(\d+),(\d+),(\d+)[^^]*\^FS/g)) {
    els.push(`<rect x="${g[1]}" y="${g[2]}" width="${g[3]}" height="${g[4]}" fill="none" stroke="#000" stroke-width="${g[5]}"/>`);
  }
  return wrapSvg(W, H, els);
}

/** Aktif dile göre görsel önizleme SVG'si. Çizicisi olmayan/geçersiz → null (HTML/text'e düş).
 *  widthDots yalnız PPLA için gerekli (genişlik komut akışında yok). */
export function renderNativePreviewSvg(language: PrinterLanguage, native: string, widthDots?: number): string | null {
  if (language === PrinterLanguage.PPLB) return renderPplbToSvg(native);
  if (language === PrinterLanguage.PPLA) return renderPplaToSvg(native, widthDots ?? 799);
  if (language === PrinterLanguage.ZPL) return renderZplToSvg(native);
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

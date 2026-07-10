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
import { qrSymbolModules } from "./native-label.shared";

// EPL2 bitmap font kodu → {w,h} dot (çarpan öncesi). Generator EPL_FONT ile AYNI değerler
// (native-label.shared) — önizleme metni yazıcı hücresiyle birebir (textLength ile).
const EPL_FONT_BY_CODE: Record<string, { w: number; h: number }> = {
  "1": { w: 8, h: 12 }, "2": { w: 10, h: 16 }, "3": { w: 12, h: 20 },
  "4": { w: 14, h: 24 }, "5": { w: 32, h: 48 },
};

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
/** Font-hücresi doğru metin — genişlik textLength ile yazıcı hücresine (glyphW×char) sabitlenir,
 *  yükseklik = glyphH. Böylece önizleme metin genişliği/yüksekliği baskıyla BİREBİR. */
function svgTextCell(x: number, y: number, glyphW: number, glyphH: number, data: string, rev = false): string {
  const tl = Math.max(1, data.length * glyphW);
  const bg = rev ? `<rect x="${x}" y="${y}" width="${tl.toFixed(0)}" height="${glyphH.toFixed(0)}" fill="#000"/>` : "";
  return (
    bg +
    `<text x="${x}" y="${y}" font-family="'Courier New',monospace" font-size="${glyphH.toFixed(1)}" font-weight="600" textLength="${tl.toFixed(0)}" lengthAdjust="spacingAndGlyphs" dominant-baseline="hanging" fill="${rev ? "#fff" : "#000"}">${esc(data)}</text>`
  );
}
function svgQr(x: number, y: number, mag: number, data: string): string {
  const img = bwipImg({ bcid: "qrcode", text: data, scale: 1, backgroundcolor: "ffffff" });
  if (!img) return "";
  // Boyut = SEMBOL modülleri × mag = yazıcının fiilen BASTIĞI kara footprint. Sessiz
  // bölge (4 modül/kenar) BEYAZ kağıt → görsel boşluk olarak zaten kalır, kutuya
  // EKLENMEZ. Eklenince QR ~1.38× (29/21) şişip alt barkoda biniyordu; bwip görüntüsü
  // zaten sessiz-bölgesiz çıplak semboldür (fiziksel baskı doğrulaması — kullanıcı).
  const size = qrSymbolModules(data.length) * Math.max(1, mag);
  return `<image href="${img.uri}" x="${x}" y="${y}" width="${size.toFixed(0)}" height="${size.toFixed(0)}"/>`;
}
function svgBarcode(
  x: number,
  y: number,
  heightDots: number,
  data: string,
  human: boolean,
  widthScale = 1,
): string {
  const img = bwipImg({ bcid: "code128", text: data, scale: 2, height: 10, includetext: false, backgroundcolor: "ffffff" });
  if (!img) return "";
  // widthScale = modül kalınlığı / taban(2) — komuttaki dar-çubuk değeri önizlemeye
  // orantılı genişlik olarak yansır (mw büyütmesi "gördüğün = basılan" kalsın).
  const ww = heightDots * (img.w / img.h) * widthScale;
  let out = `<image href="${img.uri}" x="${x}" y="${y}" width="${ww.toFixed(0)}" height="${heightDots}" preserveAspectRatio="none"/>`;
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
    if ((m = ln.match(/^A(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),([NR]),"(.*)"$/))) {
      const [, x, y, rot, font, hMul, vMul, rev, text] = m;
      const fd = EPL_FONT_BY_CODE[font] ?? EPL_FONT_BY_CODE["2"];
      const cell = svgTextCell(+x, +y, fd.w * (+hMul || 1), fd.h * (+vMul || 1), text, rev === "R");
      // EPL2 rotation 1/2/3 = 90/180/270° CW; SVG rotate CW (y-aşağı) ile eşleşir.
      els.push(+rot ? `<g transform="rotate(${+rot * 90} ${x} ${y})">${cell}</g>` : cell);
      continue;
    }
    // QR: b x,y,Q,m<n>,s<mag>,"veri"
    if ((m = ln.match(/^b(\d+),(\d+),Q,m\d+,s(\d+),"(.*)"$/))) {
      els.push(svgQr(+m[1], +m[2], +m[3], m[4]));
      continue;
    }
    // Barkod: B x,y,rot,type,narrow,wide,height,human(B/N),"veri" (type 1 = Code128)
    // narrow (modül) yakalanır → önizleme genişliği orantılı (taban 2).
    if ((m = ln.match(/^B(\d+),(\d+),\d+,\d+,(\d+),\d+,(\d+),([BN]),"(.*)"$/))) {
      els.push(svgBarcode(+m[1], +m[2], +m[4], m[6], m[5] === "B", (+m[3] || 2) / 2));
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
 *  Satırlar CR-ayrık. BİRİM: kayıt koordinat/uzunluk alanları 1/100 İNÇ'tir (emitter
 *  fiziksel doğrulamayla bu birime geçti, 2026-07-10) — SVG tuvali dot olduğundan
 *  u2d() ile geri çevrilir. Font hücre boyutları dot kalır (bitmap font tablosu). */
export function renderPplaToSvg(ppla: string, widthDots: number, dpi = 203): string | null {
  const lines = ppla.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  const W = widthDots || 799;
  // 1/100 inç → dot (emitter'daki u()'nun tersi).
  const u2d = (v: number) => Math.round((v * dpi) / 100);
  let H = 0;
  const els: string[] = [];
  for (const ln of lines) {
    let m: RegExpMatchArray | null;
    // Yükseklik: <STX>M#### (max label length, 1/100 inç)
    if ((m = ln.match(/^\x02?M(\d+)$/))) { H = u2d(+m[1]); continue; }
    // QR: 1W1c<mag2><mag2><row4><col4><veri>  (metin regex'inden ÖNCE — "1W" ile başlar)
    // Modül büyütme komuttan okunur (eskiden sabit 4 varsayılıyordu — qrScale yansımıyordu).
    if ((m = ln.match(/^1W1c(\d{2})(\d{2})(\d{4})(\d{4})(.*)$/))) {
      els.push(svgQr(u2d(+m[4]), u2d(+m[3]), +m[1] || 4, m[5]));
      continue;
    }
    // Code128: 1e<n><w><h3><row4><col4><veri> — yükseklik alanı 3 HANE (fiziksel
    // doğrulandı; 4 hane alan kaydırıyordu). n (dar/modül) önizleme genişliğine yansır.
    if ((m = ln.match(/^1e(\d)\d(\d{3})(\d{4})(\d{4})(.*)$/))) {
      els.push(svgBarcode(u2d(+m[4]), u2d(+m[3]), u2d(+m[2]), m[5], false, (+m[1] || 2) / 2));
      continue;
    }
    // DPL grafik (font X): 1X11000<row4><col4>L<w4><h4> (dolu) / B<w4><h4><t4><t4> (çerçeve)
    if ((m = ln.match(/^1X\d\d000(\d{4})(\d{4})L(\d{4})(\d{4})$/))) {
      els.push(`<rect x="${u2d(+m[2])}" y="${u2d(+m[1])}" width="${u2d(+m[3])}" height="${u2d(+m[4])}" fill="#000"/>`);
      continue;
    }
    if ((m = ln.match(/^1X\d\d000(\d{4})(\d{4})B(\d{4})(\d{4})(\d{4})(\d{4})$/))) {
      els.push(
        `<rect x="${u2d(+m[2])}" y="${u2d(+m[1])}" width="${u2d(+m[3])}" height="${u2d(+m[4])}" fill="none" stroke="#000" stroke-width="${Math.max(1, u2d(+m[5]))}"/>`,
      );
      continue;
    }
    // Metin: <rot 1-4><font><wMul><hMul>000<row4><col4><veri> — DPL rot 1=0°,2=90°,
    // 3=180°, 4=270° CW (kanvas elemanları döndürülmüş metin basabilir).
    if ((m = ln.match(/^([1-4])([1-9])(\d)(\d)000(\d{4})(\d{4})(.*)$/))) {
      const fd = EPL_FONT_BY_CODE[m[2]] ?? EPL_FONT_BY_CODE["3"];
      const x = u2d(+m[6]);
      const y = u2d(+m[5]);
      const cell = svgTextCell(x, y, fd.w * (+m[3] || 1), fd.h * (+m[4] || 1), m[7]);
      const deg = (+m[1] - 1) * 90;
      els.push(deg ? `<g transform="rotate(${deg} ${x} ${y})">${cell}</g>` : cell);
      continue;
    }
    // <STX>n, <STX>L, D11, H10, Q####, E — çizim üretmez, atla.
  }
  return wrapSvg(W, H, els);
}

/** ZPL rotasyon harfi (N/R/I/B) → derece (CW). */
const ZPL_ROT: Record<string, number> = { N: 0, R: 90, I: 180, B: 270 };

/** ZPL komutlarını görsel SVG'ye çevir. Alanlar satır-içi de olabilir → global regex. */
export function renderZplToSvg(zpl: string): string | null {
  let m = zpl.match(/\^PW(\d+)/);
  const W = m ? +m[1] : 0;
  m = zpl.match(/\^LL(\d+)/);
  const H = m ? +m[1] : 0;
  const els: string[] = [];
  // Kutu ÖNCE (zemin) — ^GB w,h,t: t ≥ min(w,h) → dolu siyah (metraj bandı), yoksa çerçeve.
  for (const g of zpl.matchAll(/\^FO(\d+),(\d+)\^GB(\d+),(\d+),(\d+)[^^]*\^FS/g)) {
    const [, x, y, w, h, t] = g;
    els.push(
      +t >= Math.min(+w, +h)
        ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000"/>`
        : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000" stroke-width="${t}"/>`,
    );
  }
  // Metin: ^FO x,y^A0<rot>,h,w[^FR]^FD veri^FS (rot=N/R/I/B; ^FR = ters/beyaz)
  for (const t of zpl.matchAll(/\^FO(\d+),(\d+)\^A0([NRIB]),(\d+),(\d+)(\^FR)?\^FD([\s\S]*?)\^FS/g)) {
    const [, x, y, rot, h, w, fr, data] = t;
    const cell = svgTextCell(+x, +y, +w || +h * 0.6, +h, data, Boolean(fr));
    const deg = ZPL_ROT[rot] ?? 0;
    els.push(deg ? `<g transform="rotate(${deg} ${x} ${y})">${cell}</g>` : cell);
  }
  // QR: ^FO x,y^BQN,model,mag^FDQA,veri^FS ("QA," öneki sıyrılır)
  for (const q of zpl.matchAll(/\^FO(\d+),(\d+)\^BQN,\d+,(\d+)\^FD(?:QA,)?([\s\S]*?)\^FS/g)) {
    els.push(svgQr(+q[1], +q[2], +q[3] || 3, q[4]));
  }
  // Code128: ^FO x,y[^BY mw]^BCN,h,Y,...^FD veri^FS  (^BY = modül kalınlığı → genişlik orantılı)
  for (const b of zpl.matchAll(/\^FO(\d+),(\d+)(?:\^BY(\d+))?\^BCN,(\d+),([^,^]*),[^^]*\^FD([\s\S]*?)\^FS/g)) {
    els.push(svgBarcode(+b[1], +b[2], +b[4], b[6], b[5] === "Y", (Number(b[3]) || 2) / 2));
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

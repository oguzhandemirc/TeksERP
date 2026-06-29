// =============================================================================
// Top etiketi — PPLB (Eltron/EPL2 dialect) native komut üreteci
// =============================================================================
// `buildRollLabelPpla`'nın PPLB karşılığı. Argox OS 214 plus PPLB modunda EPL2
// komutlarını kabul eder. FAZ-1: yalnız ÜRETİLİR (saf string); ham gönderim
// simüle (printer-transport, Faz-2). Konumlar format profilinden (mm → dot),
// güvenlik payı = sol/üst başlangıç. Origin sol-üst (EPL2), y aşağı artar.
//
// NOT: font/barkod tip kodları Argox PPLB/EPL2 kılavuzuna göre; kesin yerleşim
// fiziksel test baskısıyla (Faz-2) ince ayarlanır.
// =============================================================================

import { cleanCtl, clampCopies, mmToDots, templateTextLines, LEFT_COL_MM, type NativeRenderInput } from "./native-label.shared";
import type { FontSize } from "../../config/label-fields";

const CRLF = "\r\n";

// Boyut → EPL2 font (1=küçük…5=çok büyük) + satır adım (mm). md/lg null-şablon
// yolunun mevcut font 2/4 + d(5)/d(7) değerleriyle birebir örtüşür.
const pplbFont = (s: FontSize): string => (s === "sm" ? "1" : s === "md" ? "2" : s === "lg" ? "4" : "5");
const pplbStepMm = (s: FontSize): number => (s === "sm" ? 4 : s === "md" ? 5 : s === "lg" ? 7 : 9);

/** EPL2 veri çift-tırnak içinde → veri içi `"` güvenli karaktere çevrilir. */
function eplData(s: string): string {
  return cleanCtl(s).replace(/"/g, "'");
}

export function buildRollLabelPplb({ payload, format, copies, template }: NativeRenderInput): string {
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);
  const widthDots = d(format.widthMm);
  const heightDots = d(format.heightMm);
  const margin = d(format.marginMm);
  const textX = margin + d(LEFT_COL_MM); // sağ metin kolonu (sol = QR/barkod)
  const lines: string[] = [];

  lines.push("N"); // görüntü buffer'ını temizle
  lines.push(`q${widthDots}`); // etiket genişliği (dot)
  lines.push(`Q${heightDots},${d(2)}`); // etiket boyu + aralar arası boşluk (gap)
  lines.push("D8"); // yoğunluk (density) — fiziksel test baskısıyla ayar

  // Sağ kolon metin alanları — A x,y,rot,font,hMul,vMul,N,"veri" (origin sol-üst, y aşağı)
  // Sıra/görünür/bold/font şablondan (templateTextLines); bold → hMul/vMul 1→2.
  let y = margin;
  for (const ln of templateTextLines(payload, template)) {
    const mul = ln.bold ? "2" : "1";
    lines.push(`A${textX},${Math.round(y)},0,${pplbFont(ln.size)},${mul},${mul},N,"${eplData(ln.text)}"`);
    y += d(pplbStepMm(ln.size)); // 60mm'e sığsın diye sıkı adım
  }

  // Sol kolon: QR (üst) + Code128 (alt) + okunur metin
  if (payload.barcode) {
    const bc = eplData(payload.barcode);
    // b x,y,Q(QR),m2,s3,"veri" — sol üst
    lines.push(`b${margin},${margin},Q,m2,s3,"${bc}"`);
    // B x,y,rot,type(1=Code128),narrow,wide,height,human(B),"veri" — QR'ın altı
    lines.push(`B${margin},${margin + d(28)},0,1,2,3,${d(10)},B,"${bc}"`);
  }

  lines.push(`P${clampCopies(copies)}`); // kopya adedi → bas
  return lines.join(CRLF) + CRLF;
}

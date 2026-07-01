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

import { cleanCtl, clampCopies, mmToDots, templateTextLines, resolveQrScale, resolveLineStepMm, LEFT_COL_MM, type NativeRenderInput } from "./native-label.shared";
import type { FontSize } from "../../config/label-fields";

const CRLF = "\r\n";

// Boyut → EPL2 font (1=küçük…5=çok büyük) + satır adım (mm). Adımlar 100×50 gibi
// kısa etikette QR + metin + alt barkodun sığması için sıkı tutulur.
const pplbFont = (s: FontSize): string => (s === "sm" ? "1" : s === "md" ? "2" : s === "lg" ? "4" : "5");
const pplbStepMm = (s: FontSize): number => (s === "sm" ? 3 : s === "md" ? 4 : s === "lg" ? 5 : 6.5);

/** EPL2 veri çift-tırnak içinde → veri içi `"` güvenli karaktere çevrilir. */
function eplData(s: string): string {
  return cleanCtl(s).replace(/"/g, "'");
}

export function buildRollLabelPplb({ payload, format, copies, template }: NativeRenderInput): string {
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);
  const widthDots = d(format.widthMm);
  const heightDots = d(format.heightMm);
  // Kenar-başına pay: sol=x başlangıcı, üst=y başlangıcı, alt=alt barkod, sağ=içerik sınırı.
  const left = d(format.marginLeftMm);
  const top = d(format.marginTopMm);
  const bottom = d(format.marginBottomMm);
  // Sol = BÜYÜK QR kolonu, sağ = metin. textX QR'ı net geçer (LEFT_COL_MM paylaşılır).
  const textX = left + d(LEFT_COL_MM);
  // Şablon-başına yerleşim (boş → varsayılan): QR büyütme + sabit satır adımı (mm).
  const qrScale = resolveQrScale(template?.qrScale);
  const lineStepMm = resolveLineStepMm(template?.lineStepMm != null ? Number(template.lineStepMm) : null);
  const lines: string[] = [];

  lines.push("N"); // görüntü buffer'ını temizle
  lines.push(`q${widthDots}`); // etiket genişliği (dot)
  lines.push(`Q${heightDots},${d(format.gapMm)}`); // etiket boyu + etiketler arası boşluk (gap)
  lines.push("D8"); // yoğunluk (density) — fiziksel test baskısıyla ayar

  const bc = payload.barcode ? eplData(payload.barcode) : "";

  // Sol üst: BÜYÜK QR (s<qrScale>, şablondan ayarlanır). Sol/üst pay uygulanır.
  if (bc) lines.push(`b${left},${top},Q,m2,s${qrScale},"${bc}"`);

  // Alt tam-genişlik Code128 için ayrılan blok — metin BUNUN ÜSTÜNDE kalır → çakışma yok.
  const bcHeight = d(7);
  const bcBlockTop = heightDots - bcHeight - d(6) - bottom;

  // Sağ kolon metin — A x,y,rot,font,hMul,vMul,N,"veri" (origin sol-üst, y aşağı).
  // Sıra/görünür/bold/font şablondan (templateTextLines); bold → hMul/vMul 1→2.
  let y = top;
  for (const ln of templateTextLines(payload, template)) {
    const mul = ln.bold ? "2" : "1";
    lines.push(`A${textX},${Math.round(y)},0,${pplbFont(ln.size)},${mul},${mul},N,"${eplData(ln.text)}"`);
    y += d(lineStepMm ?? pplbStepMm(ln.size));
  }

  // Alt: tam genişlik Code128 + okunur metin (metin uzasa bile altına itilir).
  if (bc) {
    const bcY = Math.max(Math.round(y) + d(1), bcBlockTop);
    lines.push(`B${left},${bcY},0,1,2,3,${bcHeight},B,"${bc}"`);
  }

  lines.push(`P${clampCopies(copies)}`); // kopya adedi → bas
  return lines.join(CRLF) + CRLF;
}

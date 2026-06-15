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

import { cleanCtl, clampCopies, mmToDots, rollTextLines, type NativeRenderInput } from "./native-label.shared";

const CRLF = "\r\n";

/** EPL2 veri çift-tırnak içinde → veri içi `"` güvenli karaktere çevrilir. */
function eplData(s: string): string {
  return cleanCtl(s).replace(/"/g, "'");
}

export function buildRollLabelPplb({ payload, format, copies }: NativeRenderInput): string {
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);
  const widthDots = d(format.widthMm);
  const heightDots = d(format.heightMm);
  const margin = d(format.marginMm);
  const lines: string[] = [];

  lines.push("N"); // görüntü buffer'ını temizle
  lines.push(`q${widthDots}`); // etiket genişliği (dot)
  lines.push(`Q${heightDots},${d(2)}`); // etiket boyu + aralar arası boşluk (gap)
  lines.push("D8"); // yoğunluk (density) — fiziksel test baskısıyla ayar

  // Metin alanları — A x,y,rot,font,hMul,vMul,N,"veri" (origin sol-üst, y aşağı)
  let y = margin;
  for (const ln of rollTextLines(payload)) {
    const font = ln.big ? "4" : "2";
    lines.push(`A${margin},${Math.round(y)},0,${font},1,1,N,"${eplData(ln.text)}"`);
    y += ln.big ? d(9) : d(6);
  }

  // Barkod (Code128) + QR
  if (payload.barcode) {
    const bc = eplData(payload.barcode);
    const bcY = Math.max(margin, heightDots - d(30));
    // B x,y,rot,type(1=Code128),narrow,wide,height,human(B),"veri"
    lines.push(`B${margin},${bcY},0,1,2,4,${d(12)},B,"${bc}"`);
    // b x,y,Q(QR),m2,s4,"veri"
    lines.push(`b${Math.max(margin, widthDots - margin - d(24))},${bcY},Q,m2,s4,"${bc}"`);
  }

  lines.push(`P${clampCopies(copies)}`); // kopya adedi → bas
  return lines.join(CRLF) + CRLF;
}

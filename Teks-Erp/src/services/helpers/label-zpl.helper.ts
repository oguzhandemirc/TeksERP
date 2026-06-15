// =============================================================================
// Top etiketi — ZPL (Zebra) native komut üreteci
// =============================================================================
// `buildRollLabelPpla`'nın ZPL karşılığı (Zebra yazıcılar + ZPL emülasyonu).
// FAZ-1: yalnız ÜRETİLİR (saf string); ham gönderim simüle (printer-transport,
// Faz-2). Konumlar format profilinden (mm → dot), güvenlik payı = sol/üst
// başlangıç. Origin sol-üst, y aşağı artar.
//
// NOT: font/barkod parametreleri ZPL II kılavuzuna göre; kesin yerleşim fiziksel
// test baskısıyla (Faz-2) ince ayarlanır.
// =============================================================================

import { cleanCtl, clampCopies, mmToDots, rollTextLines, type NativeRenderInput } from "./native-label.shared";

/** ZPL ^FD verisi ^FS'e dek sürer; kontrol önekleri `^` ve `~` veriden ayıklanır. */
function zplData(s: string): string {
  return cleanCtl(s).replace(/[\^~]/g, " ");
}

export function buildRollLabelZpl({ payload, format, copies }: NativeRenderInput): string {
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);
  const widthDots = d(format.widthMm);
  const heightDots = d(format.heightMm);
  const margin = d(format.marginMm);
  const lines: string[] = [];

  lines.push("^XA"); // etiket başlangıcı
  lines.push("^CI28"); // UTF-8 kodlama
  lines.push(`^PW${widthDots}`); // baskı genişliği (dot)
  lines.push(`^LL${heightDots}`); // etiket boyu (dot)

  // Metin alanları — ^FO x,y ^A0N,h,w ^FD veri ^FS (origin sol-üst)
  let y = margin;
  for (const ln of rollTextLines(payload)) {
    const h = ln.big ? d(6) : d(4);
    lines.push(`^FO${margin},${Math.round(y)}^A0N,${h},${h}^FD${zplData(ln.text)}^FS`);
    y += ln.big ? d(9) : d(6);
  }

  // Barkod (Code128) + QR
  if (payload.barcode) {
    const bc = zplData(payload.barcode);
    const bcY = Math.max(margin, heightDots - d(30));
    // Code128: ^BCN,height,printInterpretation(Y),N,N
    lines.push(`^FO${margin},${bcY}^BCN,${d(12)},Y,N,N^FD${bc}^FS`);
    // QR: ^BQN,2,mag ^FD QA,veri
    lines.push(`^FO${Math.max(margin, widthDots - margin - d(22))},${bcY}^BQN,2,4^FDQA,${bc}^FS`);
  }

  lines.push(`^PQ${clampCopies(copies)}`); // kopya adedi
  lines.push("^XZ"); // etiket sonu + bas
  return lines.join("\n") + "\n";
}

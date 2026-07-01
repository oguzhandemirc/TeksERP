// =============================================================================
// Top etiketi — PPLB (Eltron/EPL2 dialect) native komut üreteci — v2 yerleşim
// =============================================================================
// Argox OS-214 plus PPLB modu (EPL2). Origin sol-üst, y aşağı artar. 203dpi.
//
// v2 tasarım (sektör-standardı top etiketi, robust):
//   ┌───────────────────────────────┐
//   │ [QR]   ÜRÜN: ...               │  QR sol-üst; ayak izi qrScale ile büyür,
//   │        Renk / Kalite / ...     │  metin kolonu otomatik sağa kayar (çakışmaz)
//   │        Uzunluk / Ağırlık / ... │  satır adımı = fontYük×çarpan + boşluk (asla üst üste)
//   │ ▐█▐█▐█ Code128 (tam genişlik) │  alt bant: 1D barkod + okunur satır (sabit, en altta)
//   └───────────────────────────────┘
// Geometri native-label.shared'dan (EPL_FONT / qrFootprintDots) — önizleme AYNI
// tabloyu kullanır → "gördüğün = basılan".
// =============================================================================

import {
  cleanCtl,
  clampCopies,
  mmToDots,
  templateTextLines,
  resolveQrScale,
  resolveLineStepMm,
  EPL_FONT,
  LINE_GAP_MM,
  qrFootprintDots,
  type NativeRenderInput,
} from "./native-label.shared";

const CRLF = "\r\n";

/** EPL2 veri çift-tırnak içinde → veri içi `"` güvenli karaktere çevrilir. */
function eplData(s: string): string {
  return cleanCtl(s).replace(/"/g, "'");
}

export function buildRollLabelPplb({ payload, format, copies, template }: NativeRenderInput): string {
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);
  const widthDots = d(format.widthMm);
  const heightDots = d(format.heightMm);
  const left = d(format.marginLeftMm);
  const top = d(format.marginTopMm);
  const right = widthDots - d(format.marginRightMm);
  const bottomEdge = heightDots - d(format.marginBottomMm);

  const qrScale = resolveQrScale(template?.qrScale);
  // Satırlar arası EK boşluk (mm) — otomatik adıma eklenir; boş → LINE_GAP_MM.
  const gapMm = resolveLineStepMm(template?.lineStepMm != null ? Number(template.lineStepMm) : null) ?? LINE_GAP_MM;
  const gap = d(gapMm);

  const bc = payload.barcode ? eplData(payload.barcode) : "";
  const lines: string[] = [];

  lines.push("N"); // görüntü buffer'ını temizle
  lines.push(`q${widthDots}`); // etiket genişliği (dot)
  lines.push(`Q${heightDots},${d(format.gapMm)}`); // etiket boyu + etiketler arası boşluk
  lines.push("D8"); // yoğunluk (density) — fiziksel test baskısıyla ayarlanır

  // --- Alt bant: tam-genişlik Code128 + okunur satır (sabit, en altta) ---
  const bcBars = bc ? d(9) : 0; // bar yüksekliği
  const bcHuman = bc ? d(3.5) : 0; // okunur satır için pay
  const bcTop = bottomEdge - bcBars - bcHuman; // barkod bandının üstü

  // --- Sol üst: QR. Ayak izi = (modül+sessiz)×qrScale, içerik genişliğinin ≤%45'i ---
  let textX = left;
  if (bc) {
    const qrPx = Math.min(qrFootprintDots(bc.length, qrScale), Math.round((right - left) * 0.45));
    lines.push(`b${left},${top},Q,m2,s${qrScale},"${bc}"`);
    textX = left + qrPx + d(2); // metin QR'ı net geçer → yatay çakışma yok
  }

  // --- Sağ kolon metin — OTOMATİK adım (fontYük×çarpan + boşluk) → dikey çakışma yok ---
  let y = top;
  for (const ln of templateTextLines(payload, template)) {
    const font = EPL_FONT[ln.size] ?? EPL_FONT.md;
    const mul = ln.bold ? 2 : 1;
    const cellH = font.h * mul;
    if (y + cellH > bcTop - d(1)) break; // alt barkoda girmeden kes
    lines.push(`A${textX},${Math.round(y)},0,${font.code},${mul},${mul},N,"${eplData(ln.text)}"`);
    y += cellH + gap;
  }

  // --- Alt barkod (okunur satır yazıcı tarafından çizilir: human=B) ---
  if (bc) {
    lines.push(`B${left},${bcTop},0,1,2,3,${bcBars},B,"${bc}"`);
  }

  lines.push(`P${clampCopies(copies)}`); // kopya adedi → bas
  return lines.join(CRLF) + CRLF;
}

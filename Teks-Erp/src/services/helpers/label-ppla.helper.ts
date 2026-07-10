// =============================================================================
// Top etiketi — Argox PPLA (Datamax DPL dialect) native komut üreteci — v2 yerleşim
// =============================================================================
// PPLB/ZPL v2 ile AYNI robust yapı (paylaşılan EPL_FONT/qrFootprintDots): OTOMATİK
// satır adımı (fontYük×çarpan + boşluk → çakışmaz), QR ayak izi (metin sağa kayar),
// alt tam-genişlik Code128. Origin sol-üst, satır=y col=x.
//
// BİRİM (fiziksel doğrulama — Argox OS-214plus, 2026-07-10): DPL inç modunda
// (STX n) kayıt koordinat/uzunluk alanları 1/100 İNÇ'tir, dot DEĞİL. Dot yazmak
// her konumu ×2.03 kaydırıyordu. İç yerleşim matematiği dot'ta kalır (font
// tablosu dot), kayıt alanına yazılırken u() ile 1/100 inç'e çevrilir. Barkod
// kaydının yükseklik alanı 3 HANEdir (4 hane → alan kayması → kaçak besleme).
// STX m (metrik) bu firmware'de tutarsız — kullanma.
//
// NOT: DPL'de ZPL `^FR` gibi güvenilir bir "reverse" (beyaz-üstü-siyah) YOK →
// sağ dikey metraj bandı PPLA'da HENÜZ YOK (PPLB+ZPL'de var). DPL reverse fiziksel
// test edilince eklenecek.
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

const STX = "\x02";
const CR = "\r";

/** PPLA/DPL = NativeRenderInput; üç dil ortak girdiyi paylaşır. */
export type PplaRenderInput = NativeRenderInput;

function pad4(n: number): string {
  return String(Math.max(0, Math.min(9999, Math.round(n)))).padStart(4, "0");
}

/** DPL barkod kaydının yükseklik alanı 3 HANE — fiziksel doğrulandı (pad4 → kayma). */
function pad3(n: number): string {
  return String(Math.max(0, Math.min(999, Math.round(n)))).padStart(3, "0");
}

export function buildRollLabelPpla({ payload, format, copies, template }: PplaRenderInput): string {
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);
  // Kayıt alanı birimi: dot → 1/100 inç (fiziksel doğrulama — dosya başı notu).
  const u = (dots: number) => Math.round((dots * 100) / dpi);
  const widthDots = d(format.widthMm);
  const heightDots = d(format.heightMm);
  const left = d(format.marginLeftMm);
  const top = d(format.marginTopMm);
  const right = widthDots - d(format.marginRightMm);
  const bottomEdge = heightDots - d(format.marginBottomMm);

  const qrScale = resolveQrScale(template?.qrScale);
  const qrMod = String(qrScale).padStart(2, "0"); // DPL QR modül boyutu 2-hane
  const gap = d(resolveLineStepMm(template?.lineStepMm != null ? Number(template.lineStepMm) : null) ?? LINE_GAP_MM);
  const bc = payload.barcode ? cleanCtl(payload.barcode) : "";

  const lines: string[] = [];
  lines.push(`${STX}n`); // ölçü birimi = İNÇ (kayıt alanları 1/100 inç okunur)
  lines.push(`${STX}M${pad4(u(heightDots))}`); // maksimum etiket boyu (1/100 inç)
  lines.push(`${STX}L`); // etiket format moduna gir
  lines.push("D11"); // yoğunluk/çözünürlük modülü (203dpi)
  lines.push("H10"); // ısı (heat) — fiziksel test baskısıyla ayarlanır

  // DPL metin kaydı: <rot=1><font><wMul><hMul>"000"<RRRR row><CCCC col><veri>
  // rowDot/colDot DOT alır (iç yerleşim matematiği dot'ta), alana u() ile yazılır.
  const dplText = (text: string, rowDot: number, colDot: number, font: string, mult: string): string =>
    `1${font}${mult}000${pad4(u(rowDot))}${pad4(u(colDot))}${cleanCtl(text)}`;

  // --- Alt bant: tam-genişlik Code128 + okunur satır (sabit, en altta) ---
  const bcBars = bc ? d(9) : 0;
  const bcHuman = bc ? d(4) : 0;
  const bcTop = bottomEdge - bcBars - bcHuman;

  // --- Sol üst: QR; ayak izi qrScale ile → metin kolonu sağa kayar (çakışmaz) ---
  let colText = left;
  if (bc) {
    const qrPx = Math.min(qrFootprintDots(bc.length, qrScale), Math.round((right - left) * 0.45));
    lines.push(`1W1c${qrMod}${qrMod}${pad4(u(top))}${pad4(u(left))}${bc}`);
    colText = left + qrPx + d(2);
  }

  // --- Sağ kolon metin — OTOMATİK adım (fontYük×çarpan + boşluk) → çakışma yok ---
  let row = top;
  for (const ln of templateTextLines(payload, template)) {
    const f = EPL_FONT[ln.size] ?? EPL_FONT.md;
    const mul = ln.bold ? 2 : 1;
    const cellH = f.h * mul;
    if (row + cellH > bcTop - d(1)) break;
    lines.push(dplText(ln.text, row, colText, f.code, ln.bold ? "22" : "11"));
    row += cellH + gap;
  }

  // --- Alt Code128 + okunur metin ---
  if (bc) {
    lines.push(`1e22${pad3(u(bcBars))}${pad4(u(bcTop))}${pad4(u(left))}${bc}`); // <rot>e<narrow><wide><h3><row4><col4><veri>
    lines.push(dplText(bc, bcTop + bcBars + d(1), left, "1", "11")); // okunur satır (küçük font)
  }

  lines.push(`Q${pad4(clampCopies(copies))}`); // kopya adedi
  lines.push("E"); // formatı bitir + bas
  return lines.join(CR) + CR;
}

// =============================================================================
// Top etiketi — ZPL (Zebra) native komut üreteci — v2 yerleşim
// =============================================================================
// PPLB v2 ile AYNI robust yapı (paylaşılan EPL_FONT/qrFootprintDots): otomatik
// satır adımı (fontYük×çarpan + boşluk → çakışmaz), QR ayak izi (metin sağa kayar),
// alt tam-genişlik Code128, sağ dikey metraj bandı (^GB siyah kutu + ^FR beyaz
// döndürülmüş değer). Origin sol-üst, y aşağı. 203dpi.
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
  bannerValueText,
  mediaTypeCommand,
  type NativeRenderInput,
} from "./native-label.shared";

/** ZPL ^FD verisi ^FS'e dek sürer; kontrol önekleri `^` ve `~` veriden ayıklanır. */
function zplData(s: string): string {
  return cleanCtl(s).replace(/[\^~]/g, " ");
}

export function buildRollLabelZpl({ payload, format, copies, template }: NativeRenderInput): string {
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);
  const widthDots = d(format.widthMm);
  const heightDots = d(format.heightMm);
  const left = d(format.marginLeftMm);
  const top = d(format.marginTopMm);
  const right = widthDots - d(format.marginRightMm);
  const bottomEdge = heightDots - d(format.marginBottomMm);

  const qrMag = Math.min(10, resolveQrScale(template?.qrScale)); // ZPL BQ mag 1–10
  const gap = d(resolveLineStepMm(template?.lineStepMm != null ? Number(template.lineStepMm) : null) ?? LINE_GAP_MM);

  const bc = payload.barcode ? zplData(payload.barcode) : "";

  // Sağ dikey metraj bandı (PPLB ile aynı) — ters TEK değil, ZPL'de ^GB+^FR net çalışır.
  const bannerOn =
    template?.lengthBanner === true &&
    payload.lengthMeters != null &&
    String(payload.lengthMeters).trim() !== "" &&
    payload.kind !== "SWATCH";
  const BANNER_MUL = 3;
  const bannerW = bannerOn ? EPL_FONT.xl.h * BANNER_MUL : 0;
  const contentRight = bannerOn ? right - bannerW - d(2) : right;

  const lines: string[] = [];
  lines.push("^XA");
  // Baskı yöntemi (ribon): cihaz mediaType'ından ^MTD/^MTT — boşsa yazıcı otomatik.
  const mc = mediaTypeCommand(format.language, format.mediaType);
  if (mc) lines.push(mc);
  lines.push("^CI28"); // UTF-8
  lines.push(`^PW${widthDots}`);
  lines.push(`^LL${heightDots}`);

  // Alt bant: tam-genişlik Code128 + okunur satır
  const bcBars = bc ? d(9) : 0;
  const bcHuman = bc ? d(3.5) : 0;
  const bcTop = bottomEdge - bcBars - bcHuman;

  // QR sol-üst; ayak izi qrMag ile → metin kolonu sağa kayar (çakışmaz)
  let textX = left;
  if (bc) {
    const qrPx = Math.min(qrFootprintDots(bc, qrMag), Math.round((contentRight - left) * 0.45));
    lines.push(`^FO${left},${top}^BQN,2,${qrMag}^FDQA,${bc}^FS`);
    textX = left + qrPx + d(2);
  }

  // Sağ kolon metin — OTOMATİK adım (fontYük×çarpan + boşluk) → çakışma yok
  let y = top;
  for (const ln of templateTextLines(payload, template)) {
    const f = EPL_FONT[ln.size] ?? EPL_FONT.md;
    const mul = ln.bold ? 2 : 1;
    const h = f.h * mul;
    const w = f.w * mul;
    if (y + h > bcTop - d(1)) break;
    lines.push(`^FO${textX},${Math.round(y)}^A0N,${h},${w}^FD${zplData(ln.text)}^FS`);
    y += h + gap;
  }

  // Alt barkod
  if (bc) {
    lines.push(`^FO${left},${bcTop}^BCN,${bcBars},Y,N,N^FD${bc}^FS`);
  }

  // Sağ dikey metraj bandı — solid siyah kutu (^GB) + döndürülmüş ters (^A0R+^FR) beyaz değer
  if (bannerOn) {
    const val = zplData(bannerValueText(payload));
    const charLen = EPL_FONT.xl.w * BANNER_MUL;
    const bannerH = bottomEdge - top;
    // Siyah arka planı uzat: boşluk dolgusu (^FR ile beyaz metin, siyah boşluk hücresi)
    const targetChars = Math.max(val.length, Math.floor((bannerH * 0.6) / charLen));
    const padEach = Math.floor((targetChars - val.length) / 2);
    const padded = " ".repeat(padEach) + val + " ".repeat(padEach);
    const bx = right - bannerW;
    const gh = EPL_FONT.xl.h * BANNER_MUL;
    const gw = EPL_FONT.xl.w * BANNER_MUL;
    const textLen = padded.length * charLen;
    lines.push(`^FO${bx},${top}^GB${bannerW},${bannerH},${bannerW},B^FS`); // solid siyah (t=w → dolu)
    // ^A0R (90° CW) döndürülmüş, ^FR ters (kutu üzerinde beyaz). Dikeyde ortalı.
    const ty = top + Math.round((bannerH - textLen) / 2);
    lines.push(`^FO${bx},${ty}^A0R,${gh},${gw}^FR^FD${padded}^FS`);
  }

  lines.push(`^PQ${clampCopies(copies)}`);
  lines.push("^XZ");
  return lines.join("\n") + "\n";
}

// =============================================================================
// Top etiketi — Argox PPLA (Datamax DPL dialect) native komut üreteci
// =============================================================================
// `buildRollLabelHtml`'in native analoğu. Aynı mantıksal alanları (ürün/renk/
// kalite/metraj/en/ağırlık/müşteri/parti + Code128 + QR) PPLA komut string'i
// olarak üretir. Konumlar format profilinden hesaplanır (mm → dot; 203dpi=8dot/mm);
// güvenlik payı (marginMm) iç koordinat başlangıcı olur.
//
// FAZ-1 SINIRI: bu fonksiyon yalnız KOMUT ÜRETİR (saf string — HTML üretmek gibi,
// izinli). Komutların yazıcıya ham-bayt GÖNDERİMİ donanım I/O'dur → `printer-transport`
// içinde SİMÜLE (Faz-2'de gerçek socket/USB). "Yazıcı değişse de kodlar kaybolmasın"
// = bu üreteç versiyonlu kodda, model→dil eşlemesi DB'de.
//
// NOT: Alan/font/barkod tip kodları Argox OS-214 plus PPLA programlama kılavuzuna
// göredir; kesin değerler fiziksel test baskısıyla (Faz-2) ince ayarlanır. Yapı +
// veri tamdır; üretim/önizleme/inceleme bugün çalışır.
// =============================================================================

import {
  cleanCtl,
  clampCopies,
  mmToDots,
  rollTextLines,
  LEFT_COL_MM,
  type NativeRenderInput,
} from "./native-label.shared";

const STX = "\x02";
const CR = "\r";

/** PPLA/DPL = NativeRenderInput; üç dil ortak girdiyi paylaşır. */
export type PplaRenderInput = NativeRenderInput;

function pad4(n: number): string {
  return String(Math.max(0, Math.min(9999, Math.round(n)))).padStart(4, "0");
}

export function buildRollLabelPpla({ payload, format, copies }: PplaRenderInput): string {
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);
  const marginDots = d(format.marginMm);
  const colText = marginDots + d(LEFT_COL_MM); // sağ metin kolonu (sol = QR/barkod)
  const lines: string[] = [];

  // --- Başlık: birim, etiket boyu, ısı/yoğunluk ---
  lines.push(`${STX}n`); // ölçü birimi = nokta (dot)
  lines.push(`${STX}M${pad4(d(format.heightMm))}`); // maksimum etiket boyu
  lines.push(`${STX}L`); // etiket format moduna gir
  lines.push("D11"); // yoğunluk/çözünürlük modülü (203dpi)
  lines.push("H10"); // ısı (heat) — fiziksel test baskısıyla ayarlanır

  // DPL metin kaydı: <rot><font><wMul><hMul>"000"<RRRR row><CCCC col><veri>
  //   rot=1 (0°), font=3 (standart) / 4 (büyük); satır dot ÜSTTEN, sütun SOLDAN.
  const dplText = (text: string, rowDot: number, colDot: number, font = "3"): string =>
    `1${font}11000${pad4(rowDot)}${pad4(colDot)}${cleanCtl(text)}`;

  // --- Sağ kolon: metin satırları (üstten aşağı; paylaşılan kind-bilinçli liste) ---
  let row = marginDots;
  for (const ln of rollTextLines(payload)) {
    lines.push(dplText(ln.text, row, colText, ln.big ? "4" : "3"));
    row += ln.big ? d(7) : d(5); // 60mm'e sığsın diye sıkı adım
  }

  // --- Sol kolon: QR (üst) + Code128 (alt) + okunabilir metin ---
  if (payload.barcode) {
    const bc = cleanCtl(payload.barcode);
    // QR — DPL 2D kaydı ("W1c"...) sol üst köşe
    lines.push(`1W1c0606${pad4(marginDots)}${pad4(marginDots)}${bc}`);
    // Code128 (QR'ın altı): <rot>"e"<narrow><wide><HHHH height><RRRR><CCCC><veri>
    const bcRow = marginDots + d(28);
    lines.push(`1e22${pad4(d(10))}${pad4(bcRow)}${pad4(marginDots)}${bc}`);
    // okunabilir barkod metni (barkodun altı)
    lines.push(dplText(bc, bcRow + d(11), marginDots));
  }

  // --- Kopya + bitir/bas ---
  lines.push(`Q${pad4(clampCopies(copies))}`); // kopya adedi (1-5)
  lines.push("E"); // formatı bitir + bas

  return lines.join(CR) + CR;
}

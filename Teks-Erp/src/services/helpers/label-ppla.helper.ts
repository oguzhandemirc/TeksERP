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
  templateTextLines,
  LEFT_COL_MM,
  type NativeRenderInput,
} from "./native-label.shared";
import type { FontSize } from "../../config/label-fields";

// Boyut → PPLA font kodu (2=küçük…5=çok büyük) ve satır adım (mm). md/lg null-şablon
// yolunun mevcut font 3/4 + d(5)/d(7) değerleriyle BİREBİR örtüşür (bayt geri uyum).
const pplaFont = (s: FontSize): string => (s === "sm" ? "2" : s === "md" ? "3" : s === "lg" ? "4" : "5");
const pplaStepMm = (s: FontSize): number => (s === "sm" ? 4 : s === "md" ? 5 : s === "lg" ? 7 : 9);

const STX = "\x02";
const CR = "\r";

/** PPLA/DPL = NativeRenderInput; üç dil ortak girdiyi paylaşır. */
export type PplaRenderInput = NativeRenderInput;

function pad4(n: number): string {
  return String(Math.max(0, Math.min(9999, Math.round(n)))).padStart(4, "0");
}

export function buildRollLabelPpla({ payload, format, copies, template }: PplaRenderInput): string {
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
  //   rot=1 (0°), font=2..5; mult=11 normal / 22 bold; satır dot ÜSTTEN, sütun SOLDAN.
  const dplText = (text: string, rowDot: number, colDot: number, font = "3", mult = "11"): string =>
    `1${font}${mult}000${pad4(rowDot)}${pad4(colDot)}${cleanCtl(text)}`;

  // --- Sağ kolon: şablon-bilinçli metin satırları (üstten aşağı; sıra/görünür/bold şablondan) ---
  let row = marginDots;
  for (const ln of templateTextLines(payload, template)) {
    lines.push(dplText(ln.text, row, colText, pplaFont(ln.size), ln.bold ? "22" : "11"));
    row += d(pplaStepMm(ln.size)); // 60mm'e sığsın diye sıkı adım
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

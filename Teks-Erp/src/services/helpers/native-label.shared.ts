// =============================================================================
// Native etiket üreteçleri (PPLA/PPLB/ZPL) için ortak yardımcılar
// =============================================================================
// Aynı mantıksal alan listesini (ürün/renk/kalite/metraj/en/ağırlık/müşteri/parti)
// üretir; her dil renderer'ı kendi sözdiziminde konumlar. 203dpi = 8 dot/mm.
// =============================================================================

import { LabelKind } from "@prisma/client";
import type { LabelPayload } from "../label.service";
import type { ResolvedLabelFormat } from "./label-format.resolver";

export interface NativeRenderInput {
  payload: LabelPayload;
  format: ResolvedLabelFormat;
  copies: number;
}

/** Yatay (100×60) düzende sol tarama kolonu genişliği (QR + barkod) — sağ metin
 *  kolonu buradan sonra başlar. Üç native dil de paylaşır. */
export const LEFT_COL_MM = 30;

export function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / 25.4);
}

// Türkçe → ASCII eşlemesi (İ/Ş/Ğ/ç vb.). Native gönderimde KRİTİK: ham 9100 baytları
// latin1; latin1-dışı karakter (İ=U+0130) kayıplı çevrilir VE daha kötüsü latin1'de
// komut-baytına denk gelir (Ş=U+015E→0x5E '^' ZPL öneki, Ğ=U+011E→0x1E kontrol) →
// frame bozulur. ASCII'ye katlayarak hem doğru hem güvenli yaparız (yazıcı codepage'i
// gerektiren tam Türkçe glif = Faz-2 fiziksel ayar konusu).
const TR_TO_ASCII: Record<string, string> = {
  "ç": "c", "Ç": "C", "ğ": "g", "Ğ": "G", "ı": "i", "İ": "I",
  "ö": "o", "Ö": "O", "ş": "s", "Ş": "S", "ü": "u", "Ü": "U",
};

/** Metni ASCII'ye katla — Türkçe map + diакритik ayıkla + kalan latin1-dışını at. */
export function asciiFold(s: string): string {
  const mapped = s.replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => TR_TO_ASCII[c] ?? c);
  return mapped
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\x7f]/g, "");
}

/**
 * Native veri alanı temizleme — kontrol karakterlerini (STX/CR/LF) ayıkla VE ASCII'ye
 * katla (latin1 kaybı/komut-baytı enjeksiyonu engellenir). Komut yapısına dokunmaz;
 * yalnız text/barkod veri alanlarına uygulanır.
 */
export function cleanCtl(s: string | number | null | undefined): string {
  // eslint-disable-next-line no-control-regex
  return asciiFold(String(s ?? "").replace(/[\x00-\x1f]/g, " ")).trim();
}

export interface RollTextLine {
  text: string;
  /** Büyük font (ürün adı + metraj). */
  big?: boolean;
}

/** Etiketin sıralı metin satırları (barkod hariç) — üç native dil paylaşır.
 *  kind=SWATCH (kartela) iken metraj yerine En×Boy + Kart No / Ana Top satırları. */
export function rollTextLines(p: LabelPayload): RollTextLine[] {
  const lines: RollTextLine[] = [];
  lines.push({ text: cleanCtl(p.itemName || "-"), big: true });
  if (p.colorName) lines.push({ text: `Renk: ${cleanCtl(p.colorName)}` });

  if (p.kind === LabelKind.SWATCH) {
    lines.push({ text: `En: ${p.widthCm ?? "-"} cm   Boy: ${p.lengthCm ?? "-"} cm`, big: true });
    if (p.weightKg != null) lines.push({ text: `Agirlik: ${cleanCtl(p.weightKg)} kg` });
    if (p.cardNumber) lines.push({ text: `Kart No: ${cleanCtl(p.cardNumber)}` });
    if (p.customerName) lines.push({ text: `Musteri: ${cleanCtl(p.customerName)}` });
    if (p.parentRollBarcode) lines.push({ text: `Ana Top: ${cleanCtl(p.parentRollBarcode)}` });
    return lines;
  }

  lines.push({ text: `Kalite: ${cleanCtl(p.qualityGrade ?? "-")}` });
  lines.push({ text: `${cleanCtl(p.lengthMeters)} mt   En: ${p.widthCm ?? "-"} cm`, big: true });
  if (p.weightKg != null) lines.push({ text: `Agirlik: ${cleanCtl(p.weightKg)} kg` });
  if (p.customerName) lines.push({ text: `Musteri: ${cleanCtl(p.customerName)}` });
  if (p.batchNumber) lines.push({ text: `Parti: ${cleanCtl(p.batchNumber)}` });
  return lines;
}

export function clampCopies(copies: number): number {
  return Math.max(1, Math.min(5, copies || 1));
}

// =============================================================================
// Native etiket üreteçleri (PPLA/PPLB/ZPL) için ortak yardımcılar
// =============================================================================
// Aynı mantıksal alan listesini (ürün/renk/kalite/metraj/en/ağırlık/müşteri/parti)
// üretir; her dil renderer'ı kendi sözdiziminde konumlar. 203dpi = 8 dot/mm.
// =============================================================================

import { LabelKind, type LabelTemplate } from "@prisma/client";
import type { LabelPayload } from "../label.service";
import type { ResolvedLabelFormat } from "./label-format.resolver";
import type { FontSize, TemplateField } from "../../config/label-fields";
import { fieldDisplayValue } from "./label-field-values";

export interface NativeRenderInput {
  payload: LabelPayload;
  format: ResolvedLabelFormat;
  copies: number;
  /** Aktif etiket şablonu — alan görünürlük/sıra/ad/bold/font. null → varsayılan
   *  (rollTextLines) çıktısı: bayt-stabil geri uyum. */
  template: LabelTemplate | null;
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

/** Native metin satırı — boyut + bold şablondan gelir; native helper'lar dile
 *  özgü font koduna eşler. text HAM (sanitize edilmemiş) — helper cleanCtl uygular. */
export interface NativeTextLine {
  text: string;
  size: FontSize;
  bold: boolean;
}

/**
 * Şablon-bilinçli native metin satırları (üç dil paylaşır). template null →
 * mevcut `rollTextLines` çıktısına delege (büyük→lg/normal→md, bold yok) =
 * BAYT-AYNI geri uyum. template dolu → görünür + scan-olmayan + değeri olan
 * alanlar `order`'a göre; headline çıplak değer, row "Etiket: değer"; size/bold
 * şablon `fontSize`/`isBold`'dan. Sol QR+barkod tarama kolonu burada YOK (sabit).
 */
export function templateTextLines(
  payload: LabelPayload,
  template: LabelTemplate | null,
): NativeTextLine[] {
  if (!template) {
    return rollTextLines(payload).map((ln) => ({
      text: ln.text,
      size: (ln.big ? "lg" : "md") as FontSize,
      bold: false,
    }));
  }
  const fields = (template.fields as unknown as TemplateField[] | null) ?? null;
  if (!fields) {
    return rollTextLines(payload).map((ln) => ({
      text: ln.text,
      size: (ln.big ? "lg" : "md") as FontSize,
      bold: false,
    }));
  }
  return fields
    .filter((f) => f.isVisible)
    .map((f) => ({ f, dv: fieldDisplayValue(payload, f.key) }))
    .filter((x) => x.dv.role !== "scan" && x.dv.present)
    .sort((a, b) => a.f.order - b.f.order)
    .map(({ f, dv }) => {
      const headline = dv.role === "headline";
      const size: FontSize = f.fontSize ?? (headline ? "lg" : "md");
      // Alan etiketi (label) doluysa "Etiket: değer", boşsa yalnız değer — kullanıcı
      // FieldsPanel'den başlığı yazar/siler. (Eskiden headline alanlar label'ı düşürüyordu.)
      const label = f.label?.trim();
      const text = label ? `${label}: ${dv.value}` : dv.value;
      return { text, size, bold: f.isBold ?? false };
    });
}

export function clampCopies(copies: number): number {
  return Math.max(1, Math.min(5, copies || 1));
}

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

/** Şablon-başına QR modül büyütme (dots/modül; PPLB `s`, ZPL/PPLA mag). Boş →
 *  dile-özel varsayılan (byte-compat için her dil kendi tuned değerini geçer).
 *  Dolu → makul aralığa kısılır (2–15) — çok küçük okunmaz, çok büyük sığmaz. */
export function resolveQrScale(qrScale?: number | null, defaultScale = 5): number {
  if (qrScale == null || !Number.isFinite(qrScale)) return defaultScale;
  return Math.max(2, Math.min(15, Math.round(qrScale)));
}

/** Şablon-başına satırlar arası EK boşluk (mm). Boş → varsayılan; dolu → 0–20 clamp.
 *  NOT: v2 tasarımda bu "toplam adım" DEĞİL, satırlar arası ek boşluktur — gerçek
 *  adım = fontYüksekliği×çarpan + boşluk (asla çakışmaz). */
export function resolveLineStepMm(lineStepMm?: number | null): number | null {
  if (lineStepMm == null || !Number.isFinite(lineStepMm)) return null;
  return Math.max(0, Math.min(20, lineStepMm));
}

// =============================================================================
// v2 yerleşim geometrisi — "gördüğün = basılan" için tek kaynak (generator + önizleme)
// =============================================================================

/** EPL2/PPLB dahili bitmap font boyutları (203dpi, dot) — W×H, çarpan ÖNCESİ.
 *  Font 5 (32×48) KASTEN kullanılmaz (etikete sığmaz/çakışır); xl = font4 + bold ile
 *  büyütülür. lg=headline. Önizleme bu tabloyu birebir kullanır → metin genişliği
 *  yazıcıyla eşleşir (eski FONT_H-only tahmin sapması giderildi). */
export const EPL_FONT: Record<FontSize, { code: string; w: number; h: number }> = {
  sm: { code: "1", w: 8, h: 12 },
  md: { code: "2", w: 10, h: 16 },
  lg: { code: "3", w: 12, h: 20 },
  xl: { code: "4", w: 14, h: 24 },
};

/** Satırlar arası varsayılan ek boşluk (mm) — otomatik adımda font yüksekliğine eklenir. */
export const LINE_GAP_MM = 1.2;

// =============================================================================
// SERBEST METİN BOYUTU (Etiket Stüdyosu v2) — hedef mm → en yakın basılabilir
// =============================================================================
// ZPL/HTML serbest ölçek basar (birebir); PPLA/PPLB bitmap fonttur — 5 temel
// font × dikey/yatay tam-sayı çarpan kombinasyonundan HEDEFE EN YAKINI seçilir
// (eski 4-kademe sisteminden çok daha granüler; font 5 (32×48) de kullanımda).
// Genişlik oranı (wr): yatay çarpan ayrı seçilir — dar/geniş ("ince/kalın"
// görünüm; bitmap'te vuruş kalınlığı genişlikle ölçeklenir).

const EPL_BASE_FONTS: ReadonlyArray<{ code: string; w: number; h: number }> = [
  { code: "1", w: 8, h: 12 },
  { code: "2", w: 10, h: 16 },
  { code: "3", w: 12, h: 20 },
  { code: "4", w: 14, h: 24 },
  { code: "5", w: 32, h: 48 },
];

export interface EplTextStyle {
  code: string;
  /** Dikey çarpan (yükseklik). */
  vmul: number;
  /** Yatay çarpan (genişlik — wr buradan). */
  hmul: number;
  /** Fiilen basılacak hücre (dot) — editör/önizleme "gerçekte ne çıkacak" için. */
  hDots: number;
  wDots: number;
}

/**
 * Hedef glif yüksekliği (dot) + genişlik oranı → (font, vmul, hmul).
 * Eşit sapmada BÜYÜK temel font tercih edilir (piksel çoğaltma yerine daha ince
 * doğal detay). maxMul: PPLB=6 (EPL2 güvenli aralık), PPLA/DPL=9.
 */
export function resolveEplTextStyle(targetHDots: number, wr: number, maxMul: number): EplTextStyle {
  let best = { f: EPL_BASE_FONTS[1]!, v: 1, diff: Number.POSITIVE_INFINITY };
  for (const f of EPL_BASE_FONTS) {
    for (let v = 1; v <= maxMul; v++) {
      const diff = Math.abs(f.h * v - targetHDots);
      if (diff < best.diff || (diff === best.diff && f.h > best.f.h)) {
        best = { f, v, diff };
      }
    }
  }
  const hmul = Math.max(1, Math.min(maxMul, Math.round(best.v * wr)));
  return {
    code: best.f.code,
    vmul: best.v,
    hmul,
    hDots: best.f.h * best.v,
    wDots: best.f.w * hmul,
  };
}

/** QR sembol modül sayısı (kenar), veri uzunluğundan tahmin — alnum/byte mod, ECC M.
 *  Yazıcının seçtiği sürümle birebir olmayabilir ama konumlama+önizleme için yeterli
 *  (generator textX ile önizleme QR boyutu AYNI fonksiyondan → tutarlı). */
export function qrSymbolModules(dataLen: number): number {
  if (dataLen <= 16) return 21;
  if (dataLen <= 30) return 25;
  if (dataLen <= 50) return 29;
  if (dataLen <= 70) return 33;
  return 37;
}

/** QR spec sessiz-bölge (her kenar modül). */
export const QR_QUIET_MODULES = 4;

/** QR toplam ayak izi (dot) = (sembol + 2×sessiz) × büyütme. Yazıcı `s<mag>` modeli:
 *  her modül `mag` dot. Generator (textX) ve önizleme (görsel boyut) BUNU paylaşır. */
export function qrFootprintDots(dataLen: number, mag: number): number {
  return (qrSymbolModules(dataLen) + 2 * QR_QUIET_MODULES) * Math.max(1, mag);
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

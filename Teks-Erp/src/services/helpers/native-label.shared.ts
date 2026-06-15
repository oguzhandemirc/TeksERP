// =============================================================================
// Native etiket üreteçleri (PPLA/PPLB/ZPL) için ortak yardımcılar
// =============================================================================
// Aynı mantıksal alan listesini (ürün/renk/kalite/metraj/en/ağırlık/müşteri/parti)
// üretir; her dil renderer'ı kendi sözdiziminde konumlar. 203dpi = 8 dot/mm.
// =============================================================================

import type { LabelPayload } from "../label.service";
import type { ResolvedLabelFormat } from "./label-format.resolver";

export interface NativeRenderInput {
  payload: LabelPayload;
  format: ResolvedLabelFormat;
  copies: number;
}

export function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / 25.4);
}

/** Kontrol karakterlerini (STX/CR/LF vb.) ayıkla — komut frame'ini bozmasın. */
export function cleanCtl(s: string | number | null | undefined): string {
  // eslint-disable-next-line no-control-regex
  return String(s ?? "").replace(/[\x00-\x1f]/g, " ").trim();
}

export interface RollTextLine {
  text: string;
  /** Büyük font (ürün adı + metraj). */
  big?: boolean;
}

/** Top etiketinin sıralı metin satırları (barkod hariç) — diller paylaşır. */
export function rollTextLines(p: LabelPayload): RollTextLine[] {
  const lines: RollTextLine[] = [];
  lines.push({ text: cleanCtl(p.itemName || "-"), big: true });
  if (p.colorName) lines.push({ text: `Renk: ${cleanCtl(p.colorName)}` });
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

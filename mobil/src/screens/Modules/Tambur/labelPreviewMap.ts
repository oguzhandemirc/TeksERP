// Canlı etiket önizlemesi (2026-11-10) — saf eşleme: hangi etiket alanına dokunulunca hangi düzenleyici açılır,
// ve kesim state'inden önizleme taslağı. Düzenleyiciler kesimin KENDİ state'ine yazar (iki kaynak yok);
// barkod/tarih/sabit metin ve kaynağı bizde olmayan alanlar dokunulamaz.
import type { TamburLabelPreviewDraft } from '../../../services/tambur.service';
import { parseKg, parseWidthCm } from './finalLabel';

export type PreviewEditor = 'texts' | 'length' | 'kg' | 'width' | 'quality' | 'consignee' | 'customer';

export interface PreviewEditContext {
  /** Emanet top (sahip kilidi): müşteri sabit, alıcı seçilebilir. */
  owner: boolean;
  /** Parti no alanı cari ayarıyla açık mı. */
  batchEnabled: boolean;
  /** Metre elle mi giriliyor (otomatikte makine ölçer → dokunulamaz). */
  manualLength: boolean;
}

const TEXT_KEYS = new Set(['itemName', 'deliveryNoteItemText', 'colorName', 'deliveryNoteColorText']);
const BATCH_KEYS = new Set(['labelBatchNo', 'customerBatchNo']);

/** Alan anahtarı → düzenleyici; null = dokunulamaz. */
export function editorForKey(key: string | null | undefined, ctx: PreviewEditContext): PreviewEditor | null {
  if (!key) return null;
  if (TEXT_KEYS.has(key)) return 'texts';
  if (BATCH_KEYS.has(key)) return ctx.batchEnabled ? 'texts' : null;
  switch (key) {
    case 'lengthMeters':
      return ctx.manualLength ? 'length' : null;
    case 'weightKg':
      return 'kg';
    case 'widthCm':
      return 'width';
    case 'qualityGrade':
      return 'quality';
    case 'consigneeName':
      return ctx.owner ? 'consignee' : null;
    case 'customerName':
      return ctx.owner ? null : 'customer';
    default:
      return null;
  }
}

export interface PreviewDraftInput {
  lengthText: string;
  kgText: string;
  widthText: string;
  qualityCode: string | null | undefined;
  itemName: string;
  colorName: string;
  batch: { enabled: boolean; value: string };
}

function positive(n: number | null | undefined): number | null {
  return n != null && Number.isFinite(n) && n > 0 ? n : null;
}

/** Kesim state'i → önizleme taslağı (boş metre = kalanı kes; sunucu ana kalanı basar). */
export function buildPreviewDraft(i: PreviewDraftInput): TamburLabelPreviewDraft {
  const len = parseFloat(i.lengthText.trim().replace(',', '.'));
  const kg = parseKg(i.kgText);
  const w = parseWidthCm(i.widthText);
  return {
    lengthMeters: positive(len),
    weightKg: positive(kg),
    widthCm: positive(w),
    qualityGrade: i.qualityCode ? i.qualityCode : null,
    labelItemName: i.itemName.trim() || null,
    labelColorName: i.colorName.trim() || null,
    labelBatchNo: i.batch.enabled ? i.batch.value.trim() || null : null,
  };
}

/** Alt şerit Kes düğmesinin ikinci satırı — bugünkü Kes varyantını söyler; metre doluysa satır yok. */
export function kesSubLabel(mode: 'manual' | 'auto', lengthText: string, remaining: number): string | null {
  if (mode === 'auto') return 'makineden ölç';
  if (lengthText.trim() === '' && remaining > 0.001) return `kalanı kes · ${remaining.toFixed(1)} m`;
  return null;
}

/** Kip düğmesi: o anki kipi gösterir, dokununca diğerine geçer. */
export function nextCutMode(mode: 'manual' | 'auto'): 'manual' | 'auto' {
  return mode === 'manual' ? 'auto' : 'manual';
}

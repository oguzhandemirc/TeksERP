// Canlı etiket önizlemesi (2026-11-10) — saf eşleme: hangi etiket alanına dokunulunca hangi düzenleyici açılır,
// ve kesim state'inden önizleme taslağı. Düzenleyiciler kesimin KENDİ state'ine yazar (iki kaynak yok);
// barkod/tarih/sabit metin ve kaynağı bizde olmayan alanlar dokunulamaz.
import type { TamburLabelPreviewDraft } from '../../../services/tambur.service';
import { parseKg, parseWidthCm } from './finalLabel';

export type PreviewEditor = 'itemName' | 'colorName' | 'batch' | 'length' | 'kg' | 'width' | 'quality' | 'consignee' | 'customer';

/** Yerinde (kâğıdın üstünde) düzenlenen alanlar ve kutu türü; diğerleri kendi seçicisini açar. */
export type InlineEditor = 'itemName' | 'colorName' | 'batch' | 'length' | 'kg' | 'width';
export function inlineKind(e: PreviewEditor): 'number' | 'text' | null {
  if (e === 'length' || e === 'kg' || e === 'width') return 'number';
  if (e === 'itemName' || e === 'colorName' || e === 'batch') return 'text';
  return null;
}

export interface PreviewEditContext {
  /** Emanet top (sahip kilidi): müşteri sabit, alıcı seçilebilir. */
  owner: boolean;
  /** Parti no alanı cari ayarıyla açık mı. */
  batchEnabled: boolean;
  /** Metre elle mi giriliyor (otomatikte makine ölçer → dokunulamaz). */
  manualLength: boolean;
}

const ITEM_KEYS = new Set(['itemName', 'deliveryNoteItemText']);
const COLOR_KEYS = new Set(['colorName', 'deliveryNoteColorText']);
const BATCH_KEYS = new Set(['labelBatchNo', 'customerBatchNo']);

/** Alan anahtarı → düzenleyici; null = dokunulamaz. */
export function editorForKey(key: string | null | undefined, ctx: PreviewEditContext): PreviewEditor | null {
  if (!key) return null;
  if (ITEM_KEYS.has(key)) return 'itemName';
  if (COLOR_KEYS.has(key)) return 'colorName';
  if (BATCH_KEYS.has(key)) return ctx.batchEnabled ? 'batch' : null;
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
/** Kes düğmesinin ikinci satırı. Kalite seçilmemişse (düğme kapalı) neden kapalı olduğunu söyler — kural aynı. */
export function kesSubLabel(mode: 'manual' | 'auto', lengthText: string, remaining: number, hasQuality = true): string | null {
  if (!hasQuality) return 'önce kalite seçin';
  if (mode === 'auto') return 'makineden ölç';
  if (lengthText.trim() === '' && remaining > 0.001) return `kalanı kes · ${remaining.toFixed(1)} m`;
  return null;
}

/** En kutusu ipucu: topun eni, yoksa önizlemenin miras eni; ikisi de yoksa null (çağıran varsayılana düşer). */
export function widthHintText(rollWidth: number | null | undefined, sourceWidthCm: number | null | undefined): string | null {
  const w = rollWidth != null && rollWidth > 0 ? rollWidth : sourceWidthCm != null && sourceWidthCm > 0 ? sourceWidthCm : null;
  return w == null ? null : String(Math.round(w * 10) / 10).replace('.', ',');
}

/** Kip düğmesi: o anki kipi gösterir, dokununca diğerine geçer. */
export function nextCutMode(mode: 'manual' | 'auto'): 'manual' | 'auto' {
  return mode === 'manual' ? 'auto' : 'manual';
}

const FIELD_NAMES: Record<string, string> = {
  itemName: 'Ürün adı',
  deliveryNoteItemText: 'Ürün adı',
  colorName: 'Renk',
  deliveryNoteColorText: 'Renk',
  labelBatchNo: 'Parti no',
  customerBatchNo: 'Parti no',
  lengthMeters: 'Metre',
  weightKg: 'Kg',
  widthCm: 'En',
  qualityGrade: 'Kalite',
  customerName: 'Müşteri',
  consigneeName: 'Alıcı',
};

/** Önizlemede değersiz alanın yazısı (yalnız önizleme; basımda boş alan bugünkü gibi çizilmez): etiketi ya da alan adı + "— boş". */
export function emptyFieldText(label: string, bind: string | null): string {
  const name = label.trim().replace(/:$/, '') || (bind ? FIELD_NAMES[bind] : null) || 'Alan';
  return `${name} — boş`;
}

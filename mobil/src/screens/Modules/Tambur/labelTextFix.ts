// Kesilmiş topun etiket ad/renk/parti no düzeltmesi — saf kararlar (pencere, liste satırı ve jest aynı kaynaktan).
// Sunucu otoritedir (`PATCH /rolls/:id/label-texts`, `labelTextFixBlock`); buradaki küme yalnız düğmeyi kilitler.
import type { RollStatus } from '../../../types/models';
import { normalizeLabelText } from './labelTexts';

const SHIPPED: readonly RollStatus[] = ['SHIPPED', 'AT_SUBCONTRACTOR', 'AT_KARTELA'];
const DEAD: readonly RollStatus[] = ['TAMBUR_CONSUMED', 'SUBCONTRACTOR_CONSUMED', 'KARTELA_CONSUMED', 'CANCELLED', 'SCRAP', 'RETURNED_FROM_SUBCONTRACTOR'];

/** Düzeltme kilidi: null = düzeltilebilir; metin = operatöre gösterilecek neden. */
export function labelTextFixLockReason(status: RollStatus | null | undefined): string | null {
  if (!status) return null;
  if (status === 'SHIPPED') return 'Sevk edildi — etiket bilgisi düzeltilemez';
  if (SHIPPED.includes(status)) return 'Fason/kartelada — etiket bilgisi düzeltilemez';
  if (DEAD.includes(status)) return 'Top kapanmış — etiket bilgisi düzeltilemez';
  return null;
}

export interface LabelTextValues {
  itemName: string | null | undefined;
  colorName: string | null | undefined;
  batchNo: string | null | undefined;
}

/**
 * Gövde: yalnız DEĞİŞEN alanlar; boşaltılan alan '' (sunucu temizler → etiket varsayılan ada döner).
 * Ad/renk sunucuda TR büyük harfe çevrilir; yalnız harf farkı olan değer gider ve sunucu `changed:false` döner.
 */
export function labelTextFixBody(
  current: LabelTextValues,
  draft: { itemName: string; colorName: string; batchNo: string },
  batchEnabled: boolean,
): { labelItemName?: string; labelColorName?: string; labelBatchNo?: string } {
  const body: { labelItemName?: string; labelColorName?: string; labelBatchNo?: string } = {};
  const same = (a: string | null, b: string | null | undefined) => a === normalizeLabelText(b ?? null);
  const item = normalizeLabelText(draft.itemName);
  const color = normalizeLabelText(draft.colorName);
  if (!same(item, current.itemName)) body.labelItemName = item ?? '';
  if (!same(color, current.colorName)) body.labelColorName = color ?? '';
  if (batchEnabled) {
    const batch = draft.batchNo.trim() === '' ? null : draft.batchNo.trim();
    if (!same(batch, current.batchNo)) body.labelBatchNo = batch ?? '';
  }
  return body;
}

/** Sunucu sınırıyla aynı (min 3, max 500). */
export function labelTextFixReasonError(reason: string): string | null {
  const t = reason.trim();
  if (t.length < 3) return 'Sebep en az 3 karakter olmalı';
  if (t.length > 500) return 'Sebep en çok 500 karakter olabilir';
  return null;
}

// "Parti Ekle" kartının saf kuralları (hareket defteri D8c) — ekransız sınanır.
import type { Roll } from '../../../types/models';
import { isAmbiguousFailure } from '../../../offline/entryAttempt';
import { classifyScannedRoll } from './scanClassify';

export interface AddBatchRoll {
  id: string;
  barcode: string;
  qty: number;
  width?: number | null;
}

export type AddOutcome =
  | { kind: 'added'; roll: AddBatchRoll }
  | { kind: 'duplicate' }
  | { kind: 'reject'; reason: string };

/** Okutulan/listeden seçilen top listeye girer mi — kabul kuralı Hızlı İş Emri ile aynı (`classifyScannedRoll`). */
export function addBatchOutcome(
  list: readonly AddBatchRoll[],
  roll: Roll & { sackId?: string | null; shipmentId?: string | null },
  lockedItemId: string | null,
): AddOutcome {
  if (list.some((r) => r.id === roll.id)) return { kind: 'duplicate' };
  const d = classifyScannedRoll(roll, lockedItemId);
  if (d.kind === 'cancelled') return { kind: 'reject', reason: 'İptal edilmiş top — önce iptali geri alın' };
  if (d.kind === 'reject') return { kind: 'reject', reason: d.reason };
  return { kind: 'added', roll: { id: roll.id, barcode: roll.barcode ?? '', qty: Number(roll.currentQty ?? 0), width: roll.width } };
}

export function totalQty(list: readonly AddBatchRoll[]): number {
  return list.reduce((acc, r) => acc + r.qty, 0);
}

/** Etki önizlemesi — Kaydet'ten önce ne olacağını tek satırda söyler. */
export function addBatchPreview(list: readonly AddBatchRoll[], firstStepName: string | null): string {
  const m = Math.round(totalQty(list)).toLocaleString('tr-TR');
  return `Yeni parti açılacak · ${list.length} top · ${m} m${firstStepName ? ` · ilk adım: ${firstStepName}` : ''}`;
}

/** Sunucunun ret listesi (400 BATCH_ADD_REJECTED / ITEM_MISMATCH) — hangi top neden. */
export function serverRejects(err: unknown): { barcode: string; reason: string }[] {
  const rejects = (err as { details?: { rejects?: unknown } } | null)?.details?.rejects;
  if (!Array.isArray(rejects)) return [];
  return rejects.filter((r): r is { barcode: string; reason: string } =>
    !!r && typeof (r as { barcode?: unknown }).barcode === 'string' && typeof (r as { reason?: unknown }).reason === 'string');
}

/**
 * İstek anahtarı: mantıksal deneme = aynı top kümesi. Küme değişirse yeni anahtar; belirsiz
 * hatada (ağ/5xx) anahtar yapışır ki tekrar basış ikinci parti açmasın; kesin 4xx'te düşer.
 */
export interface TokenSlot {
  token: string;
  key: string;
}

export function tokenFor(slot: TokenSlot | null, barcodes: readonly string[], fresh: () => string): TokenSlot {
  const key = [...barcodes].sort().join('|');
  return slot && slot.key === key ? slot : { token: fresh(), key };
}

export function slotAfterFailure(slot: TokenSlot | null, err: unknown): TokenSlot | null {
  return isAmbiguousFailure(err) ? slot : null;
}

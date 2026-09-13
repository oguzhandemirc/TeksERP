// =============================================================================
// KALEM BİRİMİ — backend `src/constants/item-unit.ts`in tablet İKİZİ
// =============================================================================
// Birim miktarın kaynağını izler: sevk defteri metredir; yalnız MT satırın
// karşılaması ölçülür. Eski backend `unit` göndermez → metre (bugünkü davranış).
export type ItemUnitCode = 'MT' | 'KG' | 'ADET';

export const ITEM_UNIT_LABEL: Record<ItemUnitCode, string> = { MT: 'm', KG: 'kg', ADET: 'adet' };

export function unitLabel(unit: string | null | undefined): string {
  return ITEM_UNIT_LABEL[(unit ?? 'MT') as ItemUnitCode] ?? String(unit);
}

export function isMeasuredUnit(unit: string | null | undefined): boolean {
  return unit == null || unit === 'MT';
}

/**
 * "Açık" rozeti metni — `null` = ölçülmüyor (KG/ADET satır; backend `openQty`yi
 * null gönderir). Metreye DÜŞÜLMEZ: "0m" basmak "hiç açık yok" yalanı olurdu.
 * `undefined` (eski backend / alan yok) da ölçülmüyor sayılır — rakam uydurulmaz.
 */
export function openQtyText(raw: number | null | undefined): string {
  return raw == null ? 'ölçülmüyor' : `${Math.round(Number(raw))}m`;
}

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

// =============================================================================
// FASON SEVK — "yanlış alana okuttun" sezgisi (saf, 2026-09-22)
// =============================================================================
// Sözleşme tek cümle: YALNIZ KESİN TERS TİP reddedilir. Tanınmayan kod (UNKNOWN)
// ASLA reddedilmez ve ASLA tahmin edilmez — alanın kendi eylemi sürer, kararı
// backend verir. Tanınmayan kodu reddetmek, elle verilmiş ya da emekliye
// ayrılmış ön ekli meşru bir kodu sahada kullanılamaz kılardı.
// =============================================================================
import type { ScanClassification } from '../../../services/scanSeries.service';

/** Kart alanına TOP barkodu okutuldu mu? (UNKNOWN → false: reddetme.) */
export function isWrongTypeForCardField(c: ScanClassification): boolean {
  return c.kind === 'ROLL';
}

/** Top alanına REFAKAT KARTI okutuldu mu? (UNKNOWN → false: reddetme.) */
export function isWrongTypeForRollField(c: ScanClassification): boolean {
  return c.kind === 'TRAVELER_CARD';
}

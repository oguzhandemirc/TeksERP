// =============================================================================
// BEKÇİ — Fason Sevk'te TANINMAYAN kod REDDEDİLMEZ
// =============================================================================
// Sözleşme: yalnız KESİN TERS TİP reddedilir. Tanınmayan kod (UNKNOWN) asla
// reddedilmez ve asla tahmin edilmez — alanın kendi eylemi sürer, kararı
// backend verir. Aksi hâlde elle verilmiş ya da emekliye ayrılmış ön ekli
// meşru bir kod sahada kullanılamaz olurdu.
//
// ⭐ NEGATİF SONDA ✓B1 (2026-09-22, ölçüldü): `isWrongTypeForCardField`ı
//    `c.kind !== 'TRAVELER_CARD'` yapınca (yani "kart değilse reddet") ❌3 —
//    UNKNOWN ve kartela kodları da reddediliyor. Geri alınca 6/6.
// =============================================================================
import { isWrongTypeForCardField, isWrongTypeForRollField } from './fasonScanGuards';
import { FALLBACK_SCAN_SERIES, classifyWithTable } from '../../../services/scanSeries.service';

const c = (code: string) => classifyWithTable(FALLBACK_SCAN_SERIES, code);

describe('Fason Sevk — yalnız KESİN ters tip reddedilir', () => {
  it('kart alanına TOP barkodu okutulursa reddedilir', () => {
    expect(isWrongTypeForCardField(c('T220926H0001'))).toBe(true);
  });
  it('top alanına REFAKAT KARTI okutulursa reddedilir', () => {
    expect(isWrongTypeForRollField(c('IE2209260001'))).toBe(true);
    expect(isWrongTypeForRollField(c('RK2209260001'))).toBe(true); // emekli ön ek
  });
  it('⭐ TANINMAYAN kod hiçbir alanda reddedilmez (elle/emekli kod sahada kalsın)', () => {
    for (const kod of ['A-17', 'FSN2209260001', 'ZZZ999', '']) {
      expect(isWrongTypeForCardField(c(kod))).toBe(false);
      expect(isWrongTypeForRollField(c(kod))).toBe(false);
    }
  });
  it('doğru tip kendi alanında reddedilmez', () => {
    expect(isWrongTypeForCardField(c('IE2209260001'))).toBe(false);
    expect(isWrongTypeForRollField(c('T220926H0001'))).toBe(false);
  });
  it('ilgisiz ama TANINAN tip (çuval) de reddedilmez — sözleşme yalnız ters tipi kapsar', () => {
    expect(isWrongTypeForCardField(c('CV2209260001'))).toBe(false);
    expect(isWrongTypeForRollField(c('CV2209260001'))).toBe(false);
  });
  it('körlük zemini: sonda gerçekten ayırt edebiliyor', () => {
    expect(c('T220926H0001').kind).toBe('ROLL');
    expect(c('A-17').kind).toBe('UNKNOWN');
  });
});

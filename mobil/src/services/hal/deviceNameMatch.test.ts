// deviceNameMatch: taranan BT adı ↔ cihaz kaydı eşleştirme (saf).
import { matchScore, sortByMatch, MATCH_STRONG, type MatchablePeripheral } from './deviceNameMatch';

const meter2: MatchablePeripheral = {
  name: 'Tambur 2 Kat Metre', code: 'TAMBUR-METRE-2KAT', role: '2-KAT', kind: 'METER',
};
const meter4: MatchablePeripheral = {
  name: 'Tambur 4 Kat Metre', code: 'TAMBUR-METRE-4KAT', role: '4-KAT', kind: 'METER',
};
const scale: MatchablePeripheral = {
  name: 'Sevkiyat Kantarı', code: 'SEVK-KANTAR', role: 'PRIMARY', kind: 'SCALE',
};

describe('matchScore', () => {
  it('isimlendirilmiş modül kayda birebir → güçlü (≥ MATCH_STRONG)', () => {
    expect(matchScore('TAMBUR-METRE-2KAT', meter2)).toBeGreaterThanOrEqual(MATCH_STRONG);
    expect(matchScore('SEVK-KANTAR', scale)).toBeGreaterThanOrEqual(MATCH_STRONG);
  });

  it('jenerik "HC-06" / "HC06" / boş → 0 (kimlik yok)', () => {
    expect(matchScore('HC-06', meter2)).toBe(0);
    expect(matchScore('HC06', meter2)).toBe(0);
    expect(matchScore('', meter2)).toBe(0);
  });

  it('rol farklı modül → düşük skor (2-KAT modülü 4-KAT kaydına uymaz)', () => {
    // "2 KAT" içeren ad, 4-KAT kaydına 2-KAT kadar uymamalı.
    expect(matchScore('TAMBUR-METRE-2KAT', meter4)).toBeLessThan(matchScore('TAMBUR-METRE-2KAT', meter2));
  });

  it('yanlış tür/ad → zayıf (< MATCH_STRONG)', () => {
    expect(matchScore('TAMBUR-KANTAR', meter2)).toBeLessThan(MATCH_STRONG);
  });

  it('tür anahtar kelimesi küçük katkı verir', () => {
    // Kod/rol/ad eşleşmese bile "KANTAR" kelimesi SCALE kaydına >0 verir.
    expect(matchScore('YENI-KANTAR-XYZ', scale)).toBeGreaterThan(0);
  });

  it('tr-TR harf: Türkçe adlı modül eşleşir (İ/ı/Ş katlaması)', () => {
    const p: MatchablePeripheral = { name: 'Şerit Metre', code: 'ŞERİT-METRE', role: null, kind: 'METER' };
    // Küçük harf 'şerit metre' → TR upper 'ŞERİT' → ASCII katlama 'SERIT' → koda eşleşir.
    expect(matchScore('şerit metre', p)).toBeGreaterThanOrEqual(MATCH_STRONG);
    // i↔İ tuzağı: kod ASCII 'TARTI', taranan 'tarti' — katlama olmadan hiç eşleşmezdi.
    expect(matchScore('tarti', { name: 'x', code: 'TARTI', role: null, kind: 'SCALE' })).toBeGreaterThan(0);
  });

  it('kısa kod (<3) kredi vermez', () => {
    expect(matchScore('M2', { name: 'X', code: 'M2', role: null, kind: 'METER' })).toBe(0);
  });

  it('ters-kapsama: kısa taranan ad uzun kodun alt-dizisi → güçlü SAYILMAZ', () => {
    // 'TAM', 'TAMBURMETRE2KAT' kodunun alt-dizisi ama oran düşük → +0.6 verilmez.
    expect(matchScore('TAM', meter2)).toBeLessThan(MATCH_STRONG);
  });
});

describe('sortByMatch', () => {
  it('en olası cihazı üste taşır, jeneriği dibe', () => {
    const devices = [
      { name: 'HC-06', address: 'AA:00' },
      { name: 'TAMBUR-METRE-2KAT', address: 'BB:11' },
      { name: 'TAMBUR-METRE-4KAT', address: 'CC:22' },
    ];
    const sorted = sortByMatch(devices, meter2);
    expect(sorted[0].device.address).toBe('BB:11'); // 2-KAT modülü önce
    expect(sorted[0].score).toBeGreaterThanOrEqual(MATCH_STRONG);
    expect(sorted[sorted.length - 1].device.name).toBe('HC-06'); // jenerik dipte
  });

  it('hepsi jenerikse skorlar 0, sıra stabil (giriş sırası korunur)', () => {
    const devices = [
      { name: 'HC-06', address: 'AA:00' },
      { name: 'HC-06', address: 'BB:11' },
    ];
    const sorted = sortByMatch(devices, meter2);
    expect(sorted.every((s) => s.score === 0)).toBe(true);
    expect(sorted.map((s) => s.device.address)).toEqual(['AA:00', 'BB:11']);
  });
});

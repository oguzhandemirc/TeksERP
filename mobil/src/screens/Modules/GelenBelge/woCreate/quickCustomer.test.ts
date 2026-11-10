import { filledExtraCount, quickAttemptKey, quickExtraBody, sameNameHits, SIMILAR_MAX, QUICK_EXTRA_FIELDS } from './quickCustomer';

describe('quickCustomer — seçicinin Yeni ekle formu (saf)', () => {
  it('boş/boşluk alan gövdeye girmez, dolu alan kırpılır', () => {
    expect(quickExtraBody({ city: ' BURSA ', email: '  ', notes: '' })).toEqual({ city: 'BURSA' });
    expect(filledExtraCount({ city: 'X', email: ' ' })).toBe(1);
  });
  it('Diğer alanları sunucu kümesiyle aynı (alan iki uçta)', () => {
    expect(QUICK_EXTRA_FIELDS.map((f) => f.key)).toEqual(['taxNumber', 'contactName', 'contactPhone', 'email', 'city', 'district', 'address', 'notes']);
  });
  it('deneme anahtarı ad ya da dolu alan değişince değişir, boşluk farkında değişmez', () => {
    expect(quickAttemptKey('A ', { city: 'X' })).toBe(quickAttemptKey('A', { city: ' X', email: '' }));
    expect(quickAttemptKey('A', { city: 'X' })).not.toBe(quickAttemptKey('A', { city: 'Y' }));
  });
  it('eş ad katlanarak bulunur; benzerler ≥3 harfte, en çok SIMILAR_MAX', () => {
    const opts = ['MAVİ DERE', 'MAVİ DERE TEKSTİL', 'MAVİ DERE BOYA', 'ESKİ MAVİ DERE', 'MAVİ DERE A.Ş.', 'KUZEY'].map((l, i) => ({ value: String(i), label: l }));
    const h = sameNameHits('mavi  dere', opts);
    expect(h.exact?.value).toBe('0');
    expect(h.similar).toHaveLength(SIMILAR_MAX);
    expect(sameNameHits('MA', opts).similar).toEqual([]);
    expect(sameNameHits('  ', opts)).toEqual({ exact: null, similar: [] });
  });
});

import { defaultWoTypeFor, parseWoCreateKinds, toggleWoCreateKind } from './woCreateKinds';

describe('woCreateKinds (cihaz ayarı)', () => {
  it('kayıt yok / bozuk → bugünkü davranış: yalnız İE oluştur', () => {
    expect(parseWoCreateKinds(null)).toEqual(['STANDARD']);
    expect(parseWoCreateKinds('')).toEqual(['STANDARD']);
    expect(parseWoCreateKinds('FOO,BAR')).toEqual(['STANDARD']);
  });
  it('bilinen türler sabit sırada okunur', () => {
    expect(parseWoCreateKinds('CUSTOMER_GOODS,STANDARD')).toEqual(['STANDARD', 'CUSTOMER_GOODS']);
    expect(parseWoCreateKinds('CUSTOMER_GOODS')).toEqual(['CUSTOMER_GOODS']);
  });
  it('son açık tür kapatılamaz; aç/kapat sırası sabit', () => {
    expect(toggleWoCreateKind(['STANDARD'], 'STANDARD')).toEqual(['STANDARD']);
    expect(toggleWoCreateKind(['STANDARD'], 'CUSTOMER_GOODS')).toEqual(['STANDARD', 'CUSTOMER_GOODS']);
    expect(toggleWoCreateKind(['STANDARD', 'CUSTOMER_GOODS'], 'STANDARD')).toEqual(['CUSTOMER_GOODS']);
  });
  it('öteki giriş noktaları yalnız Fason açıkken Fason açar', () => {
    expect(defaultWoTypeFor(['STANDARD'])).toBeNull();
    expect(defaultWoTypeFor(['STANDARD', 'CUSTOMER_GOODS'])).toBeNull();
    expect(defaultWoTypeFor(['CUSTOMER_GOODS'])).toBe('CUSTOMER_GOODS_SERVICE');
  });
});

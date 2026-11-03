import { deliveryToLine } from './deliveryTo';

describe('deliveryToLine (K18 teslim yeri, salt okuma)', () => {
  it('eski sunucu alanı göndermez → satır yok', () => {
    expect(deliveryToLine({})).toBeNull();
    expect(deliveryToLine({ deliveryCustomer: null, deliveryAddress: null })).toBeNull();
  });
  it('kayıtlı adres kart adresine yeğlenir', () => {
    expect(deliveryToLine({ deliveryCustomer: { name: 'Boyahane A', address: 'Kart' }, deliveryAddress: 'Özel' })).toBe('Boyahane A — Özel');
  });
  it('kayıtlı adres yoksa kart adresi; o da yoksa yalnız ad', () => {
    expect(deliveryToLine({ deliveryCustomer: { name: 'Boyahane A', address: 'Kart' } })).toBe('Boyahane A — Kart');
    expect(deliveryToLine({ deliveryCustomer: { name: 'Boyahane A', address: ' ' } })).toBe('Boyahane A');
  });
});

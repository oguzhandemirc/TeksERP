import { itemTypesFor } from './item.service';

describe('itemTypesFor — Kumaş Ekle TİP seçenekleri', () => {
  it('bayrak bilinmiyorsa bugünkü liste (İplik dahil)', () => {
    expect(itemTypesFor(undefined)).toEqual(['FABRIC', 'YARN', 'CONSUMABLE']);
    expect(itemTypesFor({})).toEqual(['FABRIC', 'YARN', 'CONSUMABLE']);
  });
  it('⭐ İplik ya da bağlı olduğu Ticaret kapalıysa İplik önerilmez', () => {
    expect(itemTypesFor({ iplikEnabled: false, ticaretEnabled: true })).toEqual(['FABRIC', 'CONSUMABLE']);
    expect(itemTypesFor({ iplikEnabled: true, ticaretEnabled: false })).toEqual(['FABRIC', 'CONSUMABLE']);
  });
});

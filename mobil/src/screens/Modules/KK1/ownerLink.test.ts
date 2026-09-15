import { EMPTY_OWNER_LINK, isOwnerPickerVisible, ownerLinkPayload } from './ownerLink';

describe('ownerLink — KK1 emanet sahibi (saf, G3t)', () => {
  it('⭐ bayrak KAPALI → seçici çizilmez ve payload bugünküyle birebir (alan yok, seçim olsa bile)', () => {
    expect(isOwnerPickerVisible(false)).toBe(false);
    const p = ownerLinkPayload({ ownerCustomerId: 'c1', ownerLabel: 'Müşteri' }, false);
    expect(p).toEqual({});
    expect('ownerCustomerId' in p).toBe(false);
  });

  it('⭐ bayrak AÇIK: seçim yok → alan yok (sahipsiz top, bugünkü davranış); seçim → id', () => {
    expect(isOwnerPickerVisible(true)).toBe(true);
    expect(ownerLinkPayload(EMPTY_OWNER_LINK, true)).toEqual({});
    expect(ownerLinkPayload({ ownerCustomerId: 'c1', ownerLabel: 'Müşteri' }, true)).toEqual({ ownerCustomerId: 'c1' });
  });

  it('etiket payload\'a GİRMEZ (yalnız gösterim)', () => {
    expect(Object.keys(ownerLinkPayload({ ownerCustomerId: 'c1', ownerLabel: 'X' }, true))).toEqual(['ownerCustomerId']);
  });
});

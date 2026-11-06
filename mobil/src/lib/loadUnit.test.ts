import { isLooseUnit, loadUnitIcon, loadUnitTitle } from './loadUnit';

describe('yük birimi adı', () => {
  it('dökme / araba / çuval ve eski sunucu (alan yok)', () => {
    expect(loadUnitTitle({ unitKind: 'BULK', sackNo: 'CV1' })).toBe('Dökme');
    expect(loadUnitTitle({ unitKind: 'CART', unitLabel: 'A-12', sackNo: 'CV2' })).toBe('Araba A-12');
    expect(loadUnitTitle({ unitKind: 'SACK', sackNo: 'CV3' })).toBe('CV3');
    expect(loadUnitTitle({ sackNo: '', seq: 4 })).toBe('#4');
  });
  it('yalnız dökme/araba gevşek birimdir', () => {
    expect(isLooseUnit({ unitKind: 'BULK' })).toBe(true);
    expect(isLooseUnit({ unitKind: 'CART' })).toBe(true);
    expect(isLooseUnit({ unitKind: 'SACK' })).toBe(false);
    expect(isLooseUnit({})).toBe(false);
    expect(loadUnitIcon({})).toBe('sack');
  });
});

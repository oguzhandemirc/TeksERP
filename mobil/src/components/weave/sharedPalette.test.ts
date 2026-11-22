// Ortak palet — panel `shared-palette.test.ts` ile aynı örnekler (iki uç aynı harfi vermeli).
import { sharedYarnSlots, slotLetter, slotOf } from './sharedPalette';

describe('sharedYarnSlots', () => {
  it('tek kartta satır i → yuva i (bugünkü sonuç)', () => {
    expect(sharedYarnSlots([['pes', 'simli', 'pamuk']])).toEqual([[1, 2, 3]]);
  });

  it('aynı iplik ikinci kartta aynı yuva; yeni iplik sıradaki yuva', () => {
    expect(sharedYarnSlots([['pes', 'simli'], ['simli', 'naylon']])).toEqual([[1, 2], [2, 3]]);
  });

  it('bir kartta aynı iplik iki satırdaysa ayrı yuva', () => {
    expect(sharedYarnSlots([['pes', 'pes'], ['pes', 'x', 'pes']])).toEqual([[1, 2], [1, 3, 2]]);
  });

  it('anahtarsız satır birleşmez; boş girdi', () => {
    expect(sharedYarnSlots([[null, 'a'], [null, 'a']])).toEqual([[1, 2], [3, 2]]);
    expect(sharedYarnSlots([])).toEqual([]);
  });

  it('slotOf / slotLetter', () => {
    expect(slotOf(undefined, 2)).toBe(2);
    expect(slotOf([3, 1], 1)).toBe(3);
    expect(slotLetter(1)).toBe('A');
    expect(slotLetter(3)).toBe('C');
  });
});

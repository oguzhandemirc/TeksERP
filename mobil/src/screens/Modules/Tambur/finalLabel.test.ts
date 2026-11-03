import {
  overridePatch,
  parseKg,
  shouldAutoPrintAfterCut,
  splitSuggestion,
  unprintedRolls,
  weightError,
} from './finalLabel';
import type { Roll } from '../../../types/models';

describe('tambur final etiket kararları', () => {
  it('basım zamanı: EACH/yok → hemen bas, END → basma', () => {
    expect(shouldAutoPrintAfterCut(null)).toBe(true);
    expect(shouldAutoPrintAfterCut({ printTiming: 'EACH' })).toBe(true);
    expect(shouldAutoPrintAfterCut({ printTiming: 'END' })).toBe(false);
  });

  it('kg ayrıştırma ve tartım zorunluluğu', () => {
    expect(parseKg('12,5')).toBe(12.5);
    expect(parseKg('')).toBeNull();
    expect(Number.isNaN(parseKg('-3') as number)).toBe(true);
    expect(weightError({ weighRequired: false }, '')).toBeNull();
    expect(weightError({ weighRequired: true }, '')).toMatch(/tartılmadan/);
    expect(weightError({ weighRequired: true }, '8')).toBeNull();
    expect(weightError({ weighRequired: false }, 'abc')).toMatch(/sayı/);
  });

  it('bölme önerisi kalandan küçükse çıkar', () => {
    expect(splitSuggestion(50, 120)).toBe('50');
    expect(splitSuggestion(50.5, 120)).toBe('50,5');
    expect(splitSuggestion(50, 40)).toBeNull();
    expect(splitSuggestion(null, 120)).toBeNull();
  });

  it('basılmayanlar', () => {
    const rolls = [{ id: 'a', labelPrintedAt: null }, { id: 'b', labelPrintedAt: '2026-11-03T08:00:00Z' }, { id: 'c' }] as unknown as Roll[];
    expect(unprintedRolls(rolls).map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('etiket bilgisi: yalnız değişenler, boş bas = "", temizle = null', () => {
    const cur = { colorName: 'KREM', itemName: 'TÜL' };
    const patch = overridePatch(cur, {
      colorName: { text: 'KREM', blank: false },
      itemName: { text: '', blank: false },
      deliveryNoteItemText: { text: 'DESEN 77', blank: false },
      widthCm: { text: '', blank: true },
    });
    expect(patch).toEqual({ itemName: null, deliveryNoteItemText: 'DESEN 77', widthCm: '' });
  });
});

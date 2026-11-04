// İE formu yerleşimi: yalnız tablet yatay iki sütun; padding tablet/telefon ayrımı kısa kenardan.
import { spacing } from '../../../../theme';
import { woFormLayout } from './woLayout';

describe('woFormLayout', () => {
  it.each([
    [390, 844, 1, spacing.md],
    [844, 390, 1, spacing.md],
    [1280, 800, 2, spacing.lg],
    [800, 1280, 1, spacing.lg],
  ])('%i×%i → %i sütun, pad %i', (w, h, columns, pad) => {
    expect(woFormLayout(w, h)).toEqual({ columns, pad });
  });
  it('eşik 960dp: 959 tek, 960 iki sütun', () => {
    expect(woFormLayout(959, 700).columns).toBe(1);
    expect(woFormLayout(960, 700).columns).toBe(2);
  });
});

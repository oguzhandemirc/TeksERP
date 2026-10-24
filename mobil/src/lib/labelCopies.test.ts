// Bekçi: tablet etiket adedi seçicisinin saf mantığı (2026-10-24).
// GLOBAL'de seçici yok (bugünkü ekran); STATION'da başlangıç istasyon > genel > 2, aralık 1–5.
import {
  clampLabelCopies,
  defaultLabelCopies,
  LABEL_COPIES_MAX,
  labelCopiesEnabled,
  labelCopiesSuffix,
  stepLabelCopies,
} from './labelCopies';

describe('labelCopies — saf mantık', () => {
  it('seçici yalnız STATION modunda; bilinmeyen/eksik = GLOBAL (fail-closed)', () => {
    expect(labelCopiesEnabled('STATION')).toBe(true);
    expect(labelCopiesEnabled('GLOBAL')).toBe(false);
    expect(labelCopiesEnabled(undefined)).toBe(false);
    expect(labelCopiesEnabled('station')).toBe(false);
  });

  it('başlangıç: istasyon varsayılanı > genel adet > 2', () => {
    expect(defaultLabelCopies(4, 1)).toBe(4);
    expect(defaultLabelCopies(null, 3)).toBe(3);
    expect(defaultLabelCopies(undefined, undefined)).toBe(2);
    expect(defaultLabelCopies(9, 1)).toBe(1); // bozuk istasyon değeri yok sayılır
    expect(defaultLabelCopies(9, 0)).toBe(2);
  });

  it('adım 1–5 içinde kalır', () => {
    expect(stepLabelCopies(5, 1)).toBe(LABEL_COPIES_MAX);
    expect(stepLabelCopies(1, -1)).toBe(1);
    expect(stepLabelCopies(2, 1)).toBe(3);
    expect(clampLabelCopies(Number.NaN)).toBe(1);
    expect(clampLabelCopies(7.9)).toBe(5);
  });

  it('düğme eki yalnız seçici açıkken', () => {
    expect(labelCopiesSuffix(true, 3)).toBe(' ×3');
    expect(labelCopiesSuffix(false, 3)).toBe('');
  });
});

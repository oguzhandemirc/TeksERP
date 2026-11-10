// Cetvel bölümünün hata yokken kararı: yalnız opt-in konakta (kurşun) boş cetvel, diğerlerinde boş durum yazısı.
import { rulerSectionMode } from './inspectionModel';

describe('rulerSectionMode', () => {
  it('⭐ hata yok + alwaysRuler → cetvel', () => {
    expect(rulerSectionMode(0, true)).toBe('ruler');
  });
  it('hata yok + varsayılan → boş durum', () => {
    expect(rulerSectionMode(0, false)).toBe('empty');
  });
  it('hata varsa her konakta cetvel', () => {
    expect(rulerSectionMode(2, false)).toBe('ruler');
    expect(rulerSectionMode(2, true)).toBe('ruler');
  });
});

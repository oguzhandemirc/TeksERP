// Cetvel bölümünün hata yokken kararı: yalnız opt-in konakta (kurşun) boş cetvel, diğerlerinde boş durum yazısı.
import { overMaxWarning, rulerSectionMode, validateDefectInput, validationMaxMeter } from './inspectionModel';

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

// Kurşun "beyandan uzun top": warn kipinde kayıt geçer + uyarı; varsayılan (block) bugünkü engel.

describe('top boyunu aşan hata metresi', () => {
  it('⭐ warn: 540 > 500 kaydedilir', () => {
    expect(validateDefectInput('540', 't1', [], validationMaxMeter(500, 'warn'))).toEqual({ ok: true, meter: 540 });
  });
  it('negatif sonda: varsayılan block bugünkü gibi engeller', () => {
    expect(validateDefectInput('540', 't1', [], validationMaxMeter(500)).ok).toBe(false);
    expect(validationMaxMeter(500, 'block')).toBe(500);
  });
  it('warn kipinde mükerrer yine engellenir', () => {
    const own = [{ id: 'a', startMeter: 540, defectTypeId: 't1', errorType: 'Leke' }];
    expect(validateDefectInput('540', 't1', own, validationMaxMeter(500, 'warn')).ok).toBe(false);
  });
  it('uyarı metni yazılan ya da kayıtlı en büyük metreyle', () => {
    expect(overMaxWarning('540', [], 500)).toBe('Top beyandan uzun görünüyor (540 > 500 m)');
    expect(overMaxWarning('', [{ id: 'a', startMeter: 512.5, defectTypeId: 't', errorType: null }], 500)).toBe('Top beyandan uzun görünüyor (512.5 > 500 m)');
  });
  it('aşım yok / top metresi bilinmiyor → null', () => {
    expect(overMaxWarning('500', [], 500)).toBeNull();
    expect(overMaxWarning('', [], 500)).toBeNull();
    expect(overMaxWarning('540', [], undefined)).toBeNull();
    expect(overMaxWarning('540', [], 0)).toBeNull();
  });
});

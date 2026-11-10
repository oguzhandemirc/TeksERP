import { rememberedGrade, shortGradeLabel, startGrade } from './qualityMemory';

describe('shortGradeLabel', () => {
  it('sondaki parantezli açıklamayı düşer', () => {
    expect(shortGradeLabel('A1 (Alt Kalite)')).toBe('A1');
    expect(shortGradeLabel('Fire  (hurda) ')).toBe('Fire');
  });
  it('parantezsiz ad aynen kalır', () => {
    expect(shortGradeLabel('1. Kalite')).toBe('1. Kalite');
  });
  it('yalnız sondaki parantez düşer; ortadaki kalır', () => {
    expect(shortGradeLabel('B (iç) Kalite')).toBe('B (iç) Kalite');
  });
  it('ad yalnız parantezse boşa düşmez', () => {
    expect(shortGradeLabel('(Özel)')).toBe('(Özel)');
  });
});

describe('rememberedGrade', () => {
  const grades = [{ code: '1K', name: '1. Kalite' }, { code: 'A1', name: 'A1 (Alt Kalite)' }];
  it('katalogda olan kodu döner', () => {
    expect(rememberedGrade('A1', grades)?.name).toBe('A1 (Alt Kalite)');
  });
  it('katalogda olmayan / boş kod → null (seçimsiz)', () => {
    expect(rememberedGrade('FIRE', grades)).toBeNull();
    expect(rememberedGrade(null, grades)).toBeNull();
    expect(rememberedGrade('', grades)).toBeNull();
  });
});

describe('startGrade (başlangıç kalitesi)', () => {
  const g = [{ code: 'Q1' }, { code: 'Q2' }, { code: 'A1' }];
  it('bu cihazda son seçilen kalite önce gelir', () => {
    expect(startGrade(g[2], g[0], g, false)).toBe(g[2]);
  });
  it('ilk kullanımda (hatırlanan yok) en iyi kalite: FIRST rolü, o da yoksa katalogun ilki', () => {
    expect(startGrade(null, g[1], g, false)).toBe(g[1]);
    expect(startGrade(null, null, g, false)).toBe(g[0]);
  });
  it('"kesimden sonra sıfırla" açıkken hatırlanan atlanır; katalog boşsa null (Kes "önce kalite seçin")', () => {
    expect(startGrade(g[2], g[0], g, true)).toBe(g[0]);
    expect(startGrade(null, null, [], false)).toBeNull();
  });
});

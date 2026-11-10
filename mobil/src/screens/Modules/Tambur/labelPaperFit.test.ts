import { fitPaperScale } from './labelPaperFit';

describe('fitPaperScale', () => {
  it('genişlik sınırlı: dar alanda ölçek genişlikten gelir', () => {
    // 100×60 mm kâğıt, 500×600 px alan → genişlik 5, yükseklik 10 → 5
    expect(fitPaperScale(500, 600, 100, 60)).toBe(5);
  });
  it('yükseklik sınırlı: alçak alanda ölçek yükseklikten gelir, kâğıt alanı aşmaz', () => {
    // 100×60 mm kâğıt, 900×300 px alan → genişlik 9, yükseklik 5 → 5
    const s = fitPaperScale(900, 300, 100, 60);
    expect(s).toBe(5);
    expect(60 * s).toBeLessThanOrEqual(300);
    expect(100 * s).toBeLessThanOrEqual(900);
  });
  it('ölçülmemiş/boş alan ya da geçersiz kâğıt → 0 (çizilmez)', () => {
    expect(fitPaperScale(0, 300, 100, 60)).toBe(0);
    expect(fitPaperScale(500, 300, 0, 60)).toBe(0);
    expect(fitPaperScale(NaN, 300, 100, 60)).toBe(0);
  });
});

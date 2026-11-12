import { clampPaperPan, clampPaperZoom, doubleTapZoom, fitPaperScale, paperPanLimit, PAPER_ZOOM_MAX, PAPER_ZOOM_MIN } from './labelPaperFit';

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

describe('önizleme yakınlaştırması — ölçek ve kaydırma sınırı', () => {
  it('ölçek 1× ile 4× arasında', () => {
    expect(clampPaperZoom(0.5)).toBe(PAPER_ZOOM_MIN);
    expect(clampPaperZoom(2.5)).toBe(2.5);
    expect(clampPaperZoom(9)).toBe(PAPER_ZOOM_MAX);
    expect(clampPaperZoom(NaN)).toBe(PAPER_ZOOM_MIN);
  });
  it('1×te kaydırma yok; yakınken kâğıt kenarı alanı geçmez', () => {
    // Kâğıt 400 px, alan 500 px: 1× ve 1,25×'te taşma yok.
    expect(paperPanLimit(400, 500, 1)).toBe(0);
    expect(paperPanLimit(400, 500, 1.25)).toBe(0);
    // 2×: 800 px kâğıt, 500 px alan → her yöne 150 px.
    expect(paperPanLimit(400, 500, 2)).toBe(150);
    // Sınırı aşan ölçek 4×'e kırpılır.
    expect(paperPanLimit(400, 500, 10)).toBe(paperPanLimit(400, 500, 4));
    expect(paperPanLimit(0, 500, 2)).toBe(0);
  });
  it('kaydırma sınıra kırpılır', () => {
    expect(clampPaperPan(200, 150)).toBe(150);
    expect(clampPaperPan(-200, 150)).toBe(-150);
    expect(clampPaperPan(40, 150)).toBe(40);
    expect(clampPaperPan(40, 0)).toBe(0);
    expect(clampPaperPan(NaN, 150)).toBe(0);
  });
  it('çift dokunuş: 1×te 2×e, yakınken 1×e', () => {
    expect(doubleTapZoom(1)).toBe(2);
    expect(doubleTapZoom(3)).toBe(1);
  });
});

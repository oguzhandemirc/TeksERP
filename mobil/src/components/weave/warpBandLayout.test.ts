// Tel düzeni bandı saf yerleşimi: sunucu açılımından ardışık iplik blokları, oransal geri dönüş, tek iplikte bant yok.
import { hasWarpBand, TICK_MIN_CELL, warpBandCaption, warpBandLayout } from './warpBandLayout';

const yarns = [
  { letter: 'A', code: 'P150', name: 'Polyester 150', endsCount: 2334 },
  { letter: 'B', code: 'P75', name: 'Polyester 75', endsCount: 1166 },
];
const seq = { repeat: [1, 1, 2], repeatCount: 1166, remainder: 2, totalEnds: 3500, matchesYarnEnds: true };

describe('warpBandLayout', () => {
  it('tek iplikli kart ya da eski sunucu (yarns yok) → bant yok', () => {
    expect(hasWarpBand({ yarns: undefined })).toBe(false);
    expect(hasWarpBand({ yarns: [yarns[0]!] })).toBe(false);
    expect(warpBandLayout({ yarns: [yarns[0]!], endsSequence: seq }, 300, 20)).toBeNull();
    expect(warpBandLayout({ yarns, endsSequence: seq }, 0, 20)).toBeNull();
  });

  it('"2A 1B" açılımı → AA tek blok + B; tel genişliği rapora bölünür', () => {
    const m = warpBandLayout({ yarns, endsSequence: seq }, 300, 20)!;
    expect(m.kind).toBe('sequence');
    expect(m.segments).toEqual([{ yarn: 1, x: 0, w: 200 }, { yarn: 2, x: 200, w: 100 }]);
    expect(m.ticksPath).toBe('M100 0V20M200 0V20');
  });

  it('dar telde ayraç çizilmez (uzun rapor)', () => {
    const long = { ...seq, repeat: Array.from({ length: 400 }, (_, i) => (i % 3 === 2 ? 2 : 1)) };
    const m = warpBandLayout({ yarns, endsSequence: long }, 300, 20)!;
    expect(300 / 400).toBeLessThan(TICK_MIN_CELL);
    expect(m.ticksPath).toBe('');
    expect(m.segments.reduce((s, x) => s + x.w, 0)).toBeCloseTo(300);
  });

  it('açılım yok → iplik payına göre oransal bloklar', () => {
    const m = warpBandLayout({ yarns, endsSequence: null }, 350, 20)!;
    expect(m.kind).toBe('proportional');
    expect(m.segments.map((s) => s.yarn)).toEqual([1, 2]);
    expect(m.segments[0]!.w).toBeCloseTo((2334 / 3500) * 350);
  });

  it('alt satır: rapor × tekrar + artık = toplam; açılım yoksa neden', () => {
    expect(warpBandCaption({ endsSequence: seq })).toBe('Rapor 3 tel × 1166 + 2 = 3500 tel');
    expect(warpBandCaption({ endsSequence: { ...seq, remainder: 0 } })).toBe('Rapor 3 tel × 1166 = 3500 tel');
    expect(warpBandCaption({ endsSequence: null, sequenceNote: 'karışık' })).toContain('okunamadı');
    expect(warpBandCaption({ endsSequence: null })).toContain('yazılmamış');
  });
});

// Kare ızgara saf yerleşimi: şekil, yön (1. atkı altta/üstte), döner çerçeve ayrımı, seçici, sığdırma.
import { fitCell, hasLiftPlan, rowTop, weaveGridLayout, weaveGridShape } from './weaveLayout';

const plan = [
  [1, 0, 1, 0],
  [0, 1, 0, 1],
  [1, 1, 0, 0],
];

describe('weaveGrid', () => {
  it('armür yok / eski sunucu → çizilmez', () => {
    expect(hasLiftPlan(undefined)).toBe(false);
    expect(hasLiftPlan(null)).toBe(false);
    expect(hasLiftPlan([])).toBe(false);
    expect(hasLiftPlan([[]])).toBe(false);
    expect(hasLiftPlan(plan)).toBe(true);
  });

  it('şekil: satır = armür ile seçici dizisinin büyüğü; seçici sütunu iplik sayısı ya da dizideki en büyük no', () => {
    expect(weaveGridShape({ liftPlan: plan, pickSequence: [1, 2, 1, 3, 1], yarnCount: 2 })).toEqual({ rows: 5, frames: 4, selCount: 3 });
    expect(weaveGridShape({ liftPlan: plan, pickSequence: null, yarnCount: 2 })).toEqual({ rows: 3, frames: 4, selCount: 0 });
    expect(weaveGridShape({ liftPlan: plan }, 2).rows).toBe(2);
  });

  it('yön: alttan yukarıda 1. atkı en alt satır, üstten aşağıda en üst', () => {
    expect(rowTop(0, 3, 10, 'bottom-up')).toBe(20);
    expect(rowTop(0, 3, 10, 'top-down')).toBe(0);
    const up = weaveGridLayout({ liftPlan: [[1]] , pickSequence: null }, 10, 'bottom-up');
    expect(up.liftPath).toBe('M0 0h10v10h-10Z');
    const two = weaveGridLayout({ liftPlan: [[1], [0]] }, 10, 'bottom-up');
    expect(two.liftPath).toBe('M0 10h10v10h-10Z');
    const twoDown = weaveGridLayout({ liftPlan: [[1], [0]] }, 10, 'top-down');
    expect(twoDown.liftPath).toBe('M0 0h10v10h-10Z');
  });

  it('döner çerçeve kalkıkları ayrı path; zemin yolunda yok', () => {
    const L = weaveGridLayout({ liftPlan: plan, lenoFrames: [1] }, 10, 'top-down');
    expect(L.lenoLiftPath).toBe('M0 0h10v10h-10ZM0 20h10v10h-10Z');
    expect(L.liftPath).not.toContain('M0 0h');
    expect(L.lenoBgPath).toBe('M0 0h10v30h-10Z');
  });

  it('seçici: iplik başına tek path, blok bir hücre boşlukla sağda', () => {
    const L = weaveGridLayout({ liftPlan: plan, pickSequence: [1, 2, 1], yarnCount: 2 }, 10, 'top-down');
    expect(L.selectorX).toBe(50);
    expect(L.width).toBe(70);
    expect(L.selectorPaths).toEqual([
      { yarn: 1, d: 'M50 0h10v10h-10ZM50 20h10v10h-10Z' },
      { yarn: 2, d: 'M60 10h10v10h-10Z' },
    ]);
  });

  it('512 satır × 32 çerçeve tek path başına çizilir', () => {
    const big = Array.from({ length: 512 }, (_, r) => Array.from({ length: 32 }, (_, c) => ((r + c) % 2)));
    const L = weaveGridLayout({ liftPlan: big, pickSequence: Array.from({ length: 512 }, (_, i) => (i % 3) + 1), yarnCount: 3 }, 10, 'bottom-up');
    expect(L.rows).toBe(512);
    expect(L.selectorPaths).toHaveLength(3);
  });

  it('sığdırma: [min, max] arası; çok satırda alt sınır (kaydırma)', () => {
    const avail = { width: 1400, height: 600 };
    expect(fitCell({ rows: 30, frames: 16, selCount: 3 }, avail)).toBe(20);
    expect(fitCell({ rows: 512, frames: 16, selCount: 3 }, avail)).toBe(10);
    expect(fitCell({ rows: 4, frames: 4, selCount: 0 }, avail)).toBe(28);
  });
});

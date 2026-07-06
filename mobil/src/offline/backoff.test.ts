import { jitteredBackoff } from './backoff';

describe('jitteredBackoff', () => {
  it('sınırlar doğru: exp × [0.7, 1.3], tavan 30sn', () => {
    for (let attempt = 0; attempt <= 10; attempt++) {
      const exp = Math.min(1000 * 2 ** attempt, 30_000);
      for (let i = 0; i < 50; i++) {
        const v = jitteredBackoff(attempt);
        expect(v).toBeGreaterThanOrEqual(Math.floor(exp * 0.7));
        expect(v).toBeLessThanOrEqual(Math.ceil(exp * 1.3));
      }
    }
  });

  it('gerçekten jitter üretir (deterministik senkron dalga yok)', () => {
    const values = new Set(Array.from({ length: 30 }, () => jitteredBackoff(3)));
    expect(values.size).toBeGreaterThan(1);
  });

  it('tavan: geç denemelerde patlamaz (attempt 100 → ≤ 39sn)', () => {
    const v = jitteredBackoff(100);
    expect(v).toBeLessThanOrEqual(39_000);
    expect(v).toBeGreaterThanOrEqual(21_000);
  });
});

// Tohumlu üreteç (mulberry32) — aynı tohum aynı salonu, aynı adım aynı sonucu verir.
// Durum dışarıda tutulur ki simülasyon adımı saf kalsın.

export interface Random {
  /** [0, 1) */
  next(): number;
  /** [min, max] tamsayı */
  int(min: number, max: number): number;
  /** [min, max) ondalık */
  range(min: number, max: number): number;
  pick<T>(list: readonly T[]): T;
  /** Ağırlıklı seçim: [değer, ağırlık] çiftleri. */
  weighted<T>(list: readonly (readonly [T, number])[]): T;
  state(): number;
}

export function createRandom(seed: number): Random {
  let s = seed | 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
    pick: (list) => list[Math.floor(next() * list.length)]!,
    weighted: (list) => {
      const total = list.reduce((a, [, w]) => a + w, 0);
      let r = next() * total;
      for (const [v, w] of list) {
        r -= w;
        if (r < 0) return v;
      }
      return list[list.length - 1]![0];
    },
    state: () => s,
  };
}

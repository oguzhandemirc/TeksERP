import { describe, expect, it } from "vitest";
import { endsPerYarnFromSequence, proportionalSegments, reedSample, repeatsToShow, stripCell } from "./warp-ends";

describe("warp-ends — tel düzeni yerleşimi", () => {
  it("kısa rapor 3 kez, uzun rapor tek kez çizilir", () => {
    expect(repeatsToShow(3)).toBe(3);
    expect(repeatsToShow(50)).toBe(2);
    expect(repeatsToShow(200)).toBe(1);
    expect(repeatsToShow(0)).toBe(0);
  });

  it("kare boyu genişliğe sığar, 3–18 px", () => {
    expect(stripCell(9, 300)).toBe(18);
    expect(stripCell(60, 300)).toBe(5);
    expect(stripCell(2000, 300)).toBe(3);
  });

  it("açılımdan iplik başına tel: 2A 1B × 3500 → A 2334, B 1166", () => {
    const seq = { repeat: [1, 1, 2], repeatCount: 1166, remainder: 2, totalEnds: 3500, matchesYarnEnds: true };
    expect(endsPerYarnFromSequence(seq, 2)).toEqual([2334, 1166]);
  });

  it("oransal blok: sıfır telli satır düşer, pay toplamı 100", () => {
    const s = proportionalSegments([3000, 0, 1000]);
    expect(s.map((x) => x.yarn)).toEqual([1, 3]);
    expect(s[0]!.pct).toBe(75);
    expect(proportionalSegments([0, 0])).toEqual([]);
  });
});

describe("warp-ends — tarak planı örneği", () => {
  it("kenar dişleri 0, zemin dişleri rapor sırasıyla; diş başları WeaveGrid aralığı", () => {
    const s = reedSample({ endsPerDent: 2, totalEnds: 3548, selvedgeEnds: 48, repeat: [1, 1, 2], maxSelvedgeDents: 1, groundDentsShown: 3 })!;
    expect(s.selvedgePerSide).toBe(24);
    expect(s.selvedgeDents).toBe(12);
    expect(s.groundDents).toBe(1750);
    expect(s.totalDents).toBe(1774);
    expect(s.cells).toEqual([0, 0, 1, 1, 2, 1, 1, 2]);
    expect(s.dentStarts).toEqual([0, 2, 4, 6]);
    expect(s.shownSelvedgeDents).toBe(1);
  });

  it("dişe tel yoksa / geçersizse null", () => {
    expect(reedSample({ endsPerDent: null, totalEnds: 100, selvedgeEnds: 0 })).toBeNull();
    expect(reedSample({ endsPerDent: 0, totalEnds: 100, selvedgeEnds: 0 })).toBeNull();
    expect(reedSample({ endsPerDent: 2, totalEnds: 0, selvedgeEnds: 0 })).toBeNull();
  });
});

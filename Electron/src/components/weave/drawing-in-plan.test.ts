import { describe, expect, it } from "vitest";
import { compressDrawingIn, drawingInRepeatUnit, drawingInSequenceError, parseDrawingInNotation } from "./drawing-in-plan";

// PARİTE TABLOSU — sunucu `Teks-Erp/scripts/test_tahar_plani.ts` NOTATION_CASES ile birebir aynı (null = hata).
const NOTATION_CASES: Array<[string, number[] | null]> = [
  ["3x(1-2-3-4) 5-6", [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 5, 6]],
  ["(1-2-3-4)x2", [1, 2, 3, 4, 1, 2, 3, 4]],
  ["1,2,3,4", [1, 2, 3, 4]],
  ["2x5 6", [5, 5, 6]],
  ["2x(1-2x(3-4))", [1, 3, 4, 3, 4, 1, 3, 4, 3, 4]],
  ["1 × 2", [2]],
  ["", null],
  ["(1-2", null],
  ["1-2)", null],
  ["a-b", null],
  ["3x", null],
  ["600x1", null],
];

describe("tahar planı yazımı (sunucu ikizi)", () => {
  for (const [src, want] of NOTATION_CASES) {
    it(`parite: "${src}"`, () => {
      const r = parseDrawingInNotation(src);
      if (want === null) expect(r.ok).toBe(false);
      else expect(r).toEqual({ ok: true, sequence: want });
    });
  }

  it("sıkıştırma: 3x(1-2-3-4) 5-6", () => {
    expect(compressDrawingIn([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 5, 6])).toBe("3x(1-2-3-4) 5-6");
  });

  it("sıkıştır → aç gidiş-dönüş aynı dizi", () => {
    const r = parseDrawingInNotation(compressDrawingIn([1, 1, 2, 3, 2, 3, 2, 3, 7]));
    expect(r).toEqual({ ok: true, sequence: [1, 1, 2, 3, 2, 3, 2, 3, 7] });
  });

  it("tekrar birimi [1,2,1,2,1,2] → [1,2]", () => {
    expect(drawingInRepeatUnit([1, 2, 1, 2, 1, 2])).toEqual([1, 2]);
  });

  it("çerçeve sayısını aşan numara Türkçe hata verir", () => {
    expect(drawingInSequenceError([1, 2, 5], 4)).toContain("5 numaralı çerçeve yok");
    expect(drawingInSequenceError([1, 2, 4], 4)).toBeNull();
  });
});

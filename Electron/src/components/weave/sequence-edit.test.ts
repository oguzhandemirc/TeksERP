import { describe, expect, it } from "vitest";
import {
  boxesToCode, boxesToRuns, cycleBox, formatRuns, insertBox, letterCoverage, parseSequenceCode, removeBox, runsToBoxes, setBox,
} from "./sequence-edit";

describe("parseSequenceCode", () => {
  it("atkı biçimi A2 B1 (harf önce)", () => {
    expect(parseSequenceCode("A2 B1")).toEqual({ style: "letter-first", runs: [{ letter: 1, count: 2 }, { letter: 2, count: 1 }] });
  });
  it("çözgü biçimi 2A 1B (sayı önce), küçük harf ve ayırıcılar", () => {
    expect(parseSequenceCode(" 2a, 1b ")).toEqual({ style: "digit-first", runs: [{ letter: 1, count: 2 }, { letter: 2, count: 1 }] });
    expect(parseSequenceCode("1 A 1 B")?.runs).toEqual([{ letter: 1, count: 1 }, { letter: 2, count: 1 }]);
  });
  it("yalnız harf ABAB → her harf bir kutu", () => {
    expect(runsToBoxes(parseSequenceCode("ABAB")!.runs)).toEqual([1, 2, 1, 2]);
  });
  it("boş → boş liste, okunamayan → null, sıfır adet → null", () => {
    expect(parseSequenceCode("")).toEqual({ style: "letter-first", runs: [] });
    expect(parseSequenceCode("2A B")).toBeNull();
    expect(parseSequenceCode("A0")).toBeNull();
    expect(parseSequenceCode("çözgü")).toBeNull();
  });
});

// PARİTE TABLOSU — sunucu `Teks-Erp/scripts/test_dizi_tekrar.ts` §5 ile aynı (weft-sequence.helper açılımı).
const REPEAT_PARITY: Array<{ code: string; expanded: number[] | null }> = [
  { code: "A4 B1 A4 C1", expanded: [1, 1, 1, 1, 2, 1, 1, 1, 1, 3] },
  { code: "3x(A1 B1) C2", expanded: [1, 2, 1, 2, 1, 2, 3, 3] },
  { code: "(A1 B1)x3 C2", expanded: [1, 2, 1, 2, 1, 2, 3, 3] },
  { code: "2*(A2 C1) B1", expanded: [1, 1, 3, 1, 1, 3, 2] },
  { code: "B1 2X(A1 C1)", expanded: [2, 1, 3, 1, 3] },
  { code: "3x((A1) B1)", expanded: null },
  { code: "3x(A1 B1 C1", expanded: null },
  { code: "0x(A1 B1 C1)", expanded: null },
  { code: "(A1 B1 C1)", expanded: null },
];

describe("tekrar kısaltması", () => {
  for (const c of REPEAT_PARITY) {
    it(`parite: ${c.code}`, () => {
      const p = parseSequenceCode(c.code);
      expect(p ? runsToBoxes(p.runs) : null).toEqual(c.expanded);
    });
  }
  it("10x(A2 B2 C1) D4 → 54 kutu, repeated işareti, kayıtta açık biçim", () => {
    const p = parseSequenceCode("10x(A2 B2 C1) D4")!;
    const boxes = runsToBoxes(p.runs)!;
    expect(p.repeated).toBe(true);
    expect(boxes).toHaveLength(54);
    expect(boxes.slice(0, 5)).toEqual([1, 1, 2, 2, 3]);
    expect(boxes.slice(-4)).toEqual([4, 4, 4, 4]);
    expect(boxesToCode(boxes.slice(0, 5), p.style)).toBe("A2 B2 C1");
  });
  it("çözgü 5x(2A 1B) 4C sayı-önce biçimi korunur; kısaltmasız kodda işaret yok", () => {
    const p = parseSequenceCode("5x(2A 1B) 4C")!;
    expect(p.style).toBe("digit-first");
    expect(runsToBoxes(p.runs)).toHaveLength(19);
    expect(parseSequenceCode("A2 B1")?.repeated).toBeUndefined();
  });
  it("aşırı açılım null (sunucu tavanlarının üstü)", () => {
    expect(parseSequenceCode("9999x(A9 B9)")).toBeNull();
  });
});

describe("kod ↔ kutu iki yönlü", () => {
  it("A4 B1 A4 C1 → kutular → aynı kod", () => {
    const p = parseSequenceCode("A4 B1 A4 C1")!;
    const boxes = runsToBoxes(p.runs)!;
    expect(boxes).toEqual([1, 1, 1, 1, 2, 1, 1, 1, 1, 3]);
    expect(boxesToCode(boxes, p.style)).toBe("A4 B1 A4 C1");
  });
  it("2A 1B biçimi korunur", () => {
    expect(boxesToCode([1, 1, 2], "digit-first")).toBe("2A 1B");
  });
  it("formatRuns ardışık aynı harfi birleştirmez, boxesToRuns birleştirir", () => {
    expect(formatRuns([{ letter: 1, count: 2 }, { letter: 1, count: 1 }], "letter-first")).toBe("A2 A1");
    expect(boxesToRuns([1, 1, 1])).toEqual([{ letter: 1, count: 3 }]);
  });
  it("tavanı aşan açılım null", () => {
    expect(runsToBoxes([{ letter: 1, count: 600 }])).toBeNull();
    expect(runsToBoxes([{ letter: 1, count: 3 }], 2)).toBeNull();
  });
});

describe("kutu düzenleme", () => {
  it("setBox / cycleBox döngüsel", () => {
    expect(setBox([1, 1], 1, 2)).toEqual([1, 2]);
    expect(cycleBox([1, 3], 1, 3)).toEqual([1, 1]);
    expect(cycleBox([1, 2], 0, 3)).toEqual([2, 2]);
  });
  it("insertBox önüne ekler, tavanda eklemez; removeBox", () => {
    expect(insertBox([1, 2], 1, 3)).toEqual([1, 3, 2]);
    expect(insertBox([1, 2], 9, 3)).toEqual([1, 2, 3]);
    expect(insertBox([1, 2], 0, 3, 2)).toEqual([1, 2]);
    expect(removeBox([1, 2, 3], 1)).toEqual([1, 3]);
    expect(removeBox([1], 5)).toEqual([1]);
  });
  it("letterCoverage: kartta olmayan ve hiç geçmeyen harf", () => {
    expect(letterCoverage([1, 4, 1], 3)).toEqual({ unknown: [4], missing: [2, 3] });
  });
});

import { describe, expect, it } from "vitest";
import {
  DRAWDOWN_MAX_PICKS, computeDrawdown, drawdownRepeatPicks, groundFrameIndexes, picksPerYarn, straightDraw, threadingMatrix,
} from "./weave-drawdown";
import { DEFAULT_WEAVE_DIRECTION, readWeaveDirection, rowsInDisplayOrder, writeWeaveDirection } from "./weave-direction";
import { yarnColor } from "./weave-palette";

// PARİTE TABLOSU — sunucu basımındaki `weave-drawdown.helper` aynı girdilerle aynı hücreleri vermelidir
// (0 = çözgü üstte, k = k. atkı ipliği üstte; düz tahar, döner çerçeveler hariç).
const DRAWDOWN_CASES: Array<{ name: string; input: Parameters<typeof computeDrawdown>[0]; cells: number[][] }> = [
  { name: "bez ayağı, seçicisiz", input: { liftPlan: [[1, 0], [0, 1]] }, cells: [[0, 1], [1, 0]] },
  { name: "döner çerçeveler (1, 2) kumaşa girmez", input: { liftPlan: [[1, 1, 1, 0], [1, 1, 0, 1]], lenoFrames: [1, 2] }, cells: [[0, 1], [1, 0]] },
  {
    name: "armür 2 × seçici 3 → rapor EKOK 6 atkı",
    input: { liftPlan: [[1, 0], [0, 1]], pickSequence: [1, 2, 3] },
    cells: [[0, 1], [2, 0], [0, 3], [1, 0], [0, 2], [3, 0]],
  },
  {
    name: "2× rapor tekrarı",
    input: { liftPlan: [[1, 0], [0, 1]], repeat: 2 },
    cells: [[0, 1, 0, 1], [1, 0, 1, 0], [0, 1, 0, 1], [1, 0, 1, 0]],
  },
];

describe("kumaş görünümü (drawdown)", () => {
  for (const c of DRAWDOWN_CASES) {
    it(`parite: ${c.name}`, () => {
      expect(computeDrawdown(c.input).cells).toEqual(c.cells);
    });
  }

  it("UA6007 biçimi: 16 çerçeve, 1–2 döner, 30 atkı + 30'luk seçici → 14 tel × 30 atkı", () => {
    const liftPlan = Array.from({ length: 30 }, (_, r) => Array.from({ length: 16 }, (_, c) => ((r + c) % 3 === 0 ? 1 : 0)));
    const pickSequence = Array.from({ length: 30 }, (_, i) => (i % 10 < 5 ? 1 : i % 10 < 8 ? 2 : 3));
    const dd = computeDrawdown({ liftPlan, lenoFrames: [1, 2], pickSequence });
    expect(dd.ends).toBe(14);
    expect(dd.picks).toBe(30);
    expect(dd.draw[0]).toBe(2);
  });

  it("düz tahar ve tahar matrisi", () => {
    expect(groundFrameIndexes(4, [2])).toEqual([0, 2, 3]);
    expect(straightDraw([0, 2, 3], 5)).toEqual([0, 2, 3, 0, 2]);
    expect(straightDraw([], 5)).toEqual([]);
    expect(threadingMatrix(3, [0, 2, 0])).toEqual([[1, 0, 1], [0, 0, 0], [0, 1, 0]]);
  });

  it("rapor EKOK tavanı aşarsa büyük rapor; 4× tekrarda satır tavanı", () => {
    expect(drawdownRepeatPicks(7, 0)).toBe(7);
    expect(drawdownRepeatPicks(30, 30)).toBe(30);
    expect(drawdownRepeatPicks(509, 511)).toBe(511);
    const big = computeDrawdown({ liftPlan: Array.from({ length: 512 }, () => Array(32).fill(0)), repeat: 4 });
    expect(big.picks).toBe(DRAWDOWN_MAX_PICKS);
    expect(big.ends).toBe(128);
  });

  it("iplik başına atkı sayısı (pay özeti)", () => {
    expect(picksPerYarn([1, 1, 2, 1, 3, 9], 3)).toEqual([3, 1, 1]);
  });
});

describe("ızgara yönü", () => {
  it("varsayılan alttan yukarı; görünüm sırası veriyi değiştirmez", () => {
    expect(DEFAULT_WEAVE_DIRECTION).toBe("bottom-up");
    expect(rowsInDisplayOrder(3, "bottom-up")).toEqual([2, 1, 0]);
    expect(rowsInDisplayOrder(3, "top-down")).toEqual([0, 1, 2]);
  });
  it("depo bozuk/erişilemezse varsayılana düşer, yazım sessiz", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(readWeaveDirection(store)).toBe("bottom-up");
    writeWeaveDirection("top-down", store);
    expect(readWeaveDirection(store)).toBe("top-down");
    mem.set("weave.gridDirection", "yan");
    expect(readWeaveDirection(store)).toBe("bottom-up");
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(readWeaveDirection(broken)).toBe("bottom-up");
    expect(() => writeWeaveDirection("top-down", broken)).not.toThrow();
  });
  it("palet 6'dan sonra açık tonla döner", () => {
    expect(yarnColor(1)).toBe("hsl(var(--chart-1))");
    expect(yarnColor(7)).toBe("hsl(var(--chart-1) / 0.55)");
  });
});

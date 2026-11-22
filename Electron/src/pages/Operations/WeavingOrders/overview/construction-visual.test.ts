import { describe, expect, it } from "vitest";
import { miniLiftLayout, weaveDesignHref } from "./construction-visual";

const plan = (picks: number, frames: number) => Array.from({ length: picks }, (_, r) => Array.from({ length: frames }, (_, c) => ((r + c) % 2)));

describe("miniLiftLayout", () => {
  it("⭐ UA6007 düzeni: 1–2 döner | 3–14 zemin | 3 seçici sütunu, 30 atkı", () => {
    const seq = Array.from({ length: 30 }, (_, i) => (i % 3) + 1);
    const l = miniLiftLayout(plan(30, 14), [1, 2], seq, 3)!;
    expect(l).toMatchObject({ rows: 30, frames: 14, selCols: 3, cols: 17, gaps: [2, 14] });
    expect(l.cell).toBeGreaterThanOrEqual(6);
    expect(l.cell).toBeLessThanOrEqual(12);
  });

  it("seçici yoksa yalnız çerçeveler; satır = armür satırı", () => {
    expect(miniLiftLayout(plan(8, 4), [], null, 2)).toMatchObject({ rows: 8, selCols: 0, cols: 4, gaps: [] });
  });

  it("seçici armürden uzunsa satır sayısı seçiciyi izler", () => {
    expect(miniLiftLayout(plan(4, 4), [], [1, 2, 1, 2, 1, 2], 2)!.rows).toBe(6);
  });

  it("armür yok/boş → null", () => {
    expect(miniLiftLayout(null, [], [1], 1)).toBeNull();
    expect(miniLiftLayout([], [], [1], 1)).toBeNull();
  });

  it("32 çerçevede kare 6 px tabanında kalır", () => {
    expect(miniLiftLayout(plan(512, 32), [], null, 0)!.cell).toBe(6);
  });
});

it("desen kartı bağlantısı Armür sekmesini ve ürünü taşır", () => {
  expect(weaveDesignHref("d1", "i1")).toBe("/definitions/weave-designs/d1?tab=lift&fabric=i1");
});

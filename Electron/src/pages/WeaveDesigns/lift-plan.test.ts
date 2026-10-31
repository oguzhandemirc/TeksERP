import { describe, expect, it } from "vitest";
import { liftPlanForSave, liftPlanSize, resizeLiftPlan, toggleLiftCell } from "./lift-plan";

describe("armür ızgarası yardımcıları", () => {
  it("büyütmede mevcut hücreler korunur, yeniler 0 doğar", () => {
    const grown = resizeLiftPlan([[1, 0], [0, 1]], 3, 3);
    expect(grown).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 0]]);
  });

  it("küçültmede taşan hücreler düşer; tavan 32 × 512", () => {
    expect(resizeLiftPlan([[1, 1, 1]], 1, 2)).toEqual([[1, 1]]);
    expect(liftPlanSize(resizeLiftPlan(null, 9999, 99))).toEqual({ picks: 512, frames: 32 });
  });

  it("hücre çevirme değişmez kopya döner", () => {
    const plan = [[0, 0], [0, 0]];
    const next = toggleLiftCell(plan, 1, 0);
    expect(next).toEqual([[0, 0], [1, 0]]);
    expect(plan).toEqual([[0, 0], [0, 0]]);
    expect(toggleLiftCell(next, 1, 0)).toEqual(plan);
  });

  it("boş ızgara kayda null gider", () => {
    expect(liftPlanForSave([])).toBeNull();
    expect(liftPlanForSave(resizeLiftPlan(null, 4, 0))).toBeNull();
    expect(liftPlanForSave([[1]])).toEqual([[1]]);
  });
});

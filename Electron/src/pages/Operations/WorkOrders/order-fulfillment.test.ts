import { describe, it, expect } from "vitest";
import { lineOpen, lineOpenMeasured, isEffectivelyZero, summarizeLinkedFulfillment } from "./order-fulfillment";
import type { WorkOrder } from "./types";

type OrderLink = NonNullable<WorkOrder["orderLinks"]>[number];

function link(orderLineId: string, quantity: number, shippedQty: number, status = "APPROVED"): OrderLink {
  return {
    orderLineId,
    allocatedQty: 0,
    orderLine: {
      quantity,
      shippedQty,
      width: null,
      colorId: null,
      order: { id: `o-${orderLineId}`, orderNumber: `ORD-${orderLineId}`, status },
    },
  };
}

describe("lineOpen", () => {
  it("kısmi sevk → kalan", () => expect(lineOpen(100, 40)).toBe(60));
  it("tam sevk → 0", () => expect(lineOpen(100, 100)).toBe(0));
  it("aşım → 0 (negatif clamp)", () => expect(lineOpen(100, 120)).toBe(0));
});

describe("lineOpenMeasured", () => {
  it("MT → lineOpen ile aynı (kalan)", () =>
    expect(lineOpenMeasured({ quantity: 100, shippedQty: 40, unit: "MT" })).toBe(60));
  it("unit yok (eski backend) → metre sayılır", () =>
    expect(lineOpenMeasured({ quantity: 100, shippedQty: 40 })).toBe(60));
  it("KG → null (ölçülmüyor; metreye DÜŞÜLMEZ)", () =>
    expect(lineOpenMeasured({ quantity: 100, shippedQty: 0, unit: "KG" })).toBeNull());
  it("ADET → null", () =>
    expect(lineOpenMeasured({ quantity: 12, unit: "ADET" })).toBeNull());
  it("MT aşım → 0 (clamp korunur)", () =>
    expect(lineOpenMeasured({ quantity: 100, shippedQty: 120, unit: "MT" })).toBe(0));
});

describe("isEffectivelyZero", () => {
  it("0.04 → sıfır sayılır", () => expect(isEffectivelyZero(0.04)).toBe(true));
  it("0 → sıfır", () => expect(isEffectivelyZero(0)).toBe(true));
  it("0.05 → sıfır değil", () => expect(isEffectivelyZero(0.05)).toBe(false));
  it("3 → sıfır değil", () => expect(isEffectivelyZero(3)).toBe(false));
});

describe("summarizeLinkedFulfillment", () => {
  it("toplar: istenen/sevk/açık", () => {
    expect(summarizeLinkedFulfillment([link("l1", 100, 40), link("l2", 50, 50)])).toEqual({
      requested: 150,
      shipped: 90,
      open: 60,
    });
  });
  it("İPTAL sipariş kalemi hariç", () => {
    expect(
      summarizeLinkedFulfillment([link("l1", 100, 40, "CANCELLED"), link("l2", 50, 10)]),
    ).toEqual({ requested: 50, shipped: 10, open: 40 });
  });
  it("aynı orderLineId bir kez (distinct)", () => {
    expect(summarizeLinkedFulfillment([link("l1", 100, 40), link("l1", 100, 40)])).toEqual({
      requested: 100,
      shipped: 40,
      open: 60,
    });
  });
  it("aşım → açık clamp 0", () => {
    expect(summarizeLinkedFulfillment([link("l1", 100, 120)])).toEqual({
      requested: 100,
      shipped: 120,
      open: 0,
    });
  });
  it("boş liste → sıfır", () => {
    expect(summarizeLinkedFulfillment([])).toEqual({ requested: 0, shipped: 0, open: 0 });
  });
});

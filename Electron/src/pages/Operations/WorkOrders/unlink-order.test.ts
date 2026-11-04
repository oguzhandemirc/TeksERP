import { describe, it, expect } from "vitest";
import { canUnlinkOrder, isRowLocked, lastLinkLocked, remainingSingleColor, unlinkRows } from "./unlink-order";
import type { WorkOrder } from "./types";

const link = (id: string, colorId: string | null, colorName: string | null = colorId) => ({
  orderLineId: id,
  allocatedQty: 0,
  orderLine: {
    quantity: 120,
    shippedQty: 0,
    unit: "MT",
    width: null,
    colorId,
    order: { id: `o-${id}`, orderNumber: `SP-${id}`, status: "APPROVED", customer: { id: "c", code: "C", name: "Acme" } },
    item: { id: "i", name: "Saten" },
    color: colorId ? { id: colorId, code: colorId, name: colorName ?? colorId, hex: null } : null,
  },
});

const wo = (p: Partial<WorkOrder> = {}) =>
  ({
    status: "IN_PROGRESS",
    type: "ORDER_PRODUCTION",
    targetItemId: "i",
    targetColorId: null,
    orderLinks: [link("a", "red", "Kırmızı")],
    ...p,
  }) as unknown as WorkOrder;

describe("canUnlinkOrder — tuş görünürlüğü", () => {
  it("aktif bağ + açık iş emri + izin → görünür; iki izinden biri yeter (backend aynası)", () => {
    expect(canUnlinkOrder(wo(), ["workorder:write"])).toBe(true);
    expect(canUnlinkOrder(wo(), ["mobile:is-emri-duzelt"])).toBe(true);
    expect(canUnlinkOrder(wo({ status: "PLANNED" }), ["workorder:*"])).toBe(true);
  });
  it("izinsiz / bağsız / kapalı statüde gizli", () => {
    expect(canUnlinkOrder(wo(), ["workorder:read"])).toBe(false);
    expect(canUnlinkOrder(wo({ orderLinks: [] }), ["workorder:write"])).toBe(false);
    expect(canUnlinkOrder(wo({ orderLinks: undefined }), ["workorder:write"])).toBe(false);
    for (const status of ["COMPLETED", "CANCELLED", "SUPERSEDED"] as const) {
      expect(canUnlinkOrder(wo({ status }), ["workorder:write"])).toBe(false);
    }
    expect(canUnlinkOrder(null, ["workorder:write"])).toBe(false);
  });
});

describe("son bağ kilidi", () => {
  it("hedef kumaş boşken siparişe özel iş emrinde kilitli", () => {
    expect(lastLinkLocked(wo({ targetItemId: null }))).toBe(true);
    expect(lastLinkLocked(wo())).toBe(false);
  });
  it("kilitliyken bağ sayısını 0'a indirecek seçim pasif; seçili satır geri alınabilir", () => {
    expect(isRowLocked("a", new Set(), 1, true)).toBe(true);
    expect(isRowLocked("b", new Set(["a"]), 2, true)).toBe(true);
    expect(isRowLocked("a", new Set(["a"]), 2, true)).toBe(false);
    expect(isRowLocked("b", new Set(), 2, true)).toBe(false);
    expect(isRowLocked("a", new Set(), 1, false)).toBe(false);
  });
});

describe("tek renk önerisi", () => {
  const two = wo({ orderLinks: [link("a", "red", "Kırmızı"), link("b", "blue", "Mavi"), link("c", "blue", "Mavi")] } as Partial<WorkOrder>);
  it("kalanlar tek renk + hedef renk boş → o renk", () => {
    expect(remainingSingleColor(two, new Set(["a"]))).toEqual({ id: "blue", name: "Mavi" });
  });
  it("karışık / renksiz / kalan yok / hedef renk dolu → öneri yok", () => {
    expect(remainingSingleColor(two, new Set(["b"]))).toBeNull();
    expect(remainingSingleColor(wo({ orderLinks: [link("a", "red"), link("b", null)] } as Partial<WorkOrder>), new Set(["a"]))).toBeNull();
    expect(remainingSingleColor(two, new Set(["a", "b", "c"]))).toBeNull();
    expect(remainingSingleColor({ ...two, targetColorId: "x" }, new Set(["a"]))).toBeNull();
  });
  it("satırlar sipariş no, müşteri, kumaş, renk, miktar taşır", () => {
    expect(unlinkRows(two)[0]).toMatchObject({ orderNumber: "SP-a", customerName: "Acme", itemName: "Saten", colorName: "Kırmızı", quantity: 120, unit: "MT" });
  });
});

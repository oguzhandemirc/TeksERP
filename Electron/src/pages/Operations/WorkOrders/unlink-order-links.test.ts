import { describe, expect, it } from "vitest";
import {
  canShowUnlinkOrders,
  LAST_LINK_BLOCK_REASON,
  remainingColorSuggestion,
  UNLINK_ORDER_PERMISSIONS,
  unlinkRowStates,
} from "./unlink-order-links";
import type { WorkOrder } from "./types";

type Links = NonNullable<WorkOrder["orderLinks"]>;
const link = (id: string, color: { id: string; name: string } | null = null) =>
  ({
    orderLineId: id,
    allocatedQty: 0,
    orderLine: { quantity: 1, shippedQty: 0, width: null, colorId: color?.id ?? null, color: color ? { ...color, code: color.id, hex: null } : null },
  }) as Links[number];
const yes = () => true;
const wo = (status: string, links: Links) => ({ status, orderLinks: links }) as Pick<WorkOrder, "status" | "orderLinks">;

describe("Sipariş Bağını Kopar — tuş görünürlüğü", () => {
  it("açık iş emri + bağ + izin → görünür", () => {
    expect(canShowUnlinkOrders(wo("PLANNED", [link("a")]), yes)).toBe(true);
    expect(canShowUnlinkOrders(wo("IN_PROGRESS", [link("a")]), yes)).toBe(true);
  });

  it.each(["COMPLETED", "CANCELLED", "SUPERSEDED"])("%s iş emrinde gizli", (s) => {
    expect(canShowUnlinkOrders(wo(s, [link("a")]), yes)).toBe(false);
  });

  it("bağ yoksa / iş emri yoksa gizli", () => {
    expect(canShowUnlinkOrders(wo("PLANNED", []), yes)).toBe(false);
    expect(canShowUnlinkOrders({ status: "PLANNED" } as never, yes)).toBe(false);
    expect(canShowUnlinkOrders(null, yes)).toBe(false);
  });

  it("izin backend route'unun aynası; izin yoksa gizli", () => {
    let asked: string[] = [];
    expect(canShowUnlinkOrders(wo("PLANNED", [link("a")]), (p) => ((asked = p), false))).toBe(false);
    expect(asked).toEqual(["workorder:write", "mobile:is-emri-duzelt"]);
    expect([...UNLINK_ORDER_PERMISSIONS]).toEqual(asked);
  });
});

describe("son bağ kuralı (hedef kumaş boşken)", () => {
  it("tek bağ: hedef kumaş boşsa pasif + sebep; doluysa serbest", () => {
    expect(unlinkRowStates([link("a")], new Set(), null).a).toEqual({ disabled: true, reason: LAST_LINK_BLOCK_REASON });
    expect(unlinkRowStates([link("a")], new Set(), "item-1").a).toEqual({ disabled: false, reason: null });
  });

  it("3 bağdan 2'si seçiliyse kalan tek seçilmemiş satır pasif; seçililer pasif değil", () => {
    const s = unlinkRowStates([link("a"), link("b"), link("c")], new Set(["a", "b"]), null);
    expect(s.a!.disabled).toBe(false);
    expect(s.b!.disabled).toBe(false);
    expect(s.c).toEqual({ disabled: true, reason: LAST_LINK_BLOCK_REASON });
  });

  it("3 bağdan 1'i seçiliyse hiçbiri pasif değil", () => {
    const s = unlinkRowStates([link("a"), link("b"), link("c")], new Set(["a"]), null);
    expect(Object.values(s).every((r) => !r.disabled)).toBe(true);
  });
});

describe("kalan renk önerisi", () => {
  const red = { id: "r", name: "Kırmızı" };
  const blue = { id: "b", name: "Mavi" };
  it("kalanlar tek renk ve hedef renk boş → öneri", () => {
    expect(remainingColorSuggestion([link("a", blue), link("b", red), link("c", red)], new Set(["a"]), null)).toEqual({ colorId: "r", colorName: "Kırmızı" });
  });
  it("çok renk / renksiz kalem / hedef renk dolu / kalan yok → öneri yok", () => {
    expect(remainingColorSuggestion([link("a", blue), link("b", red)], new Set(), null)).toBeNull();
    expect(remainingColorSuggestion([link("a", red), link("b")], new Set(), null)).toBeNull();
    expect(remainingColorSuggestion([link("a", red)], new Set(), "x")).toBeNull();
    expect(remainingColorSuggestion([link("a", red)], new Set(["a"]), null)).toBeNull();
  });
});

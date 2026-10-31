// SY-K2 — plan sekmesi saf parçaları: renk süzgeci query'de (sunucuda süzülür), plan alanları gövdesi
// varyantsız satırda bugünküyle aynı (yeni anahtar yok), güncellemede kaldırma için null/[] gider.
import { describe, expect, it } from "vitest";
import { orderPlanQueryString, parsePlanStates } from "./orderPlanService";
import { linePlanPayload } from "./orderLinePlanPayload";
import { readOrdersView } from "./OrdersViewTabs";
import type { OrderLineFormValues } from "./schema";

const base: OrderLineFormValues = { clientId: "c1", itemId: "i1", colorId: null, quantity: 10, width: null, unitPrice: "", customerItemName: "", customerColorName: "", requiredPropertyIds: [], targetValues: [], cutNote: "" };

describe("üretim planı servisi", () => {
  it("renk süzgeci query'ye CSV olarak gider (istemcide süzme yok)", () => {
    expect(orderPlanQueryString({ states: ["RED", "WHITE"], cursor: "x", limit: 100 })).toBe("state=RED%2CWHITE&cursor=x&limit=100");
    expect(orderPlanQueryString({ states: [] })).toBe("");
  });
  it("URL planState: tanınmayan renk düşer", () => {
    expect(parsePlanStates("RED,PURPLE,GREEN")).toEqual(["RED", "GREEN"]);
    expect(parsePlanStates(null)).toEqual([]);
  });
  it("sekme URL'den: yalnız view=plan plan sekmesidir", () => {
    expect(readOrdersView(new URLSearchParams("view=plan"))).toBe("plan");
    expect(readOrdersView(new URLSearchParams("view=x"))).toBe("list");
  });
});

describe("satır plan alanları gövdesi", () => {
  it("yeni satır: plan alanı boşsa gövdeye hiç anahtar eklenmez (bugünkü gövde)", () => {
    expect(linePlanPayload(base, "create")).toEqual({});
  });
  it("yeni satır: dolu alanlar gider", () => {
    expect(linePlanPayload({ ...base, recipeId: "r1", pieceLengthM: 50, targetValues: [{ propertyId: "p", valueId: "v" }] }, "create"))
      .toEqual({ recipeId: "r1", pieceLengthM: 50, targetValues: [{ propertyId: "p", valueId: "v" }] });
  });
  it("güncelleme: alanlar her zaman gider (kaldırma null/[] ile)", () => {
    expect(linePlanPayload(base, "update")).toEqual({ recipeId: null, pieceLengthM: null, targetValues: [] });
  });
});

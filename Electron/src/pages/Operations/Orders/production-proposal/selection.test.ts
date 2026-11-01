import { describe, expect, it } from "vitest";
import { buildApplyBody, conflictLineIds, excludedReason, initialSelection, parsePlannedM, toggled } from "./selection";
import type { ProductionProposal } from "./types";

const proposal = (over: Partial<ProductionProposal> = {}): ProductionProposal => ({
  orderId: "o1",
  orderNumber: "SIP1",
  weavingOrders: [
    { key: "W|i1|r1", itemId: "i1", itemName: "Tül", recipeId: "r1", warpSpecId: null, weftSpecId: null, weaveDesignId: null, shrinkPct: 10, plannedM: 1111.111, orderLines: [{ orderLineId: "l1", openM: 1000, allocatedM: 1000 }] },
  ],
  workOrders: [
    { key: "WO|a", itemId: "i1", itemName: "Tül", colorId: "c1", width: 280, routeId: "rt", foldType: null, targetQuantity: 1000, orderLines: [{ orderLineId: "l1", allocatedQty: 1000 }], blockedCode: null },
    { key: "WO|b", itemId: "i2", itemName: "Perde", colorId: null, width: null, routeId: null, foldType: null, targetQuantity: 50, orderLines: [{ orderLineId: "l2", allocatedQty: 50 }], blockedCode: "ROUTE_MISSING" },
  ],
  excluded: [],
  canCreate: { weaving: true, workOrder: true },
  ...over,
});

describe("üretim önerisi seçimi (SY-M3)", () => {
  it("varsayılan: izinli + engelsiz her kayıt seçili; engelli ve izinsiz seçilmez", () => {
    const s = initialSelection(proposal());
    expect([...s.weaving]).toEqual(["W|i1|r1"]);
    expect([...s.workOrders]).toEqual(["WO|a"]);
    const noPerm = initialSelection(proposal({ canCreate: { weaving: false, workOrder: true } }));
    expect(noPerm.weaving.size).toBe(0);
  });

  it("uygula gövdesi seçilen kayıtlar + düzenlenen plan metresi; satırlar öneriden", () => {
    const p = proposal();
    const s = { ...initialSelection(p), plannedM: new Map([["W|i1|r1", "1200,5"]]) };
    expect(buildApplyBody(p, s, "tok")).toEqual({
      clientToken: "tok",
      weavingOrders: [{ key: "W|i1|r1", orderLineIds: ["l1"], plannedM: 1200.5 }],
      workOrders: [{ key: "WO|a", orderLineIds: ["l1"] }],
    });
  });

  it("per-kayıt seçim: işareti kaldırılan gönderilmez; hiç seçim yoksa gövde yok", () => {
    const p = proposal();
    const s0 = initialSelection(p);
    const s = { ...s0, workOrders: toggled(s0.workOrders, "WO|a") };
    expect(buildApplyBody(p, s, "t")?.workOrders).toEqual([]);
    expect(buildApplyBody(p, { ...s, weaving: new Set<string>() }, "t")).toBeNull();
  });

  it("engelli grup seçili sayılsa bile gönderilmez; geçersiz metre gövdeyi kapatır", () => {
    const p = proposal();
    const s0 = initialSelection(p);
    expect(buildApplyBody(p, { ...s0, workOrders: new Set(["WO|a", "WO|b"]) }, "t")?.workOrders.map((w) => w.key)).toEqual(["WO|a"]);
    expect(buildApplyBody(p, { ...s0, plannedM: new Map([["W|i1|r1", "-3"]]) }, "t")).toBeNull();
    expect(parsePlannedM("")).toBeNull();
  });

  it("409 ayrıntısından planlanmış satırlar okunur; cümleler Türkçe", () => {
    const e = { response: { status: 409, data: { details: { code: "ORDER_LINE_ALREADY_PLANNED", orderLineIds: ["l1", 3] } } } };
    expect(conflictLineIds(e)).toEqual(["l1"]);
    expect(conflictLineIds({ response: { status: 409, data: { details: { code: "PROPOSAL_STALE" } } } })).toEqual([]);
    expect(excludedReason("ORDER_LINE_ALREADY_PLANNED")).toBe("zaten planlanmış");
  });
});

// =============================================================================
// BEKÇİ — iş emri ↔ levent ↔ sipariş kalemi ön doldurma (saf): dolu alan ezilmez · hedef metre
// HİÇBİR yoldan dolmaz · öneri yalnız take-up varken (`çözgü × (1 − takeUp/100)`) · fasoncu köken XOR'una uyar
// =============================================================================
import { describe, expect, it } from "vitest";
import { beamPrefillForOrder, fabricSuggestionM, orderLinePrefill, orderPrefillForBeam } from "./prefill";

describe("orderLinePrefill", () => {
  it("boş kumaş/renk kalemden dolar", () => {
    expect(orderLinePrefill({ itemId: "", colorId: "" }, [{ itemId: "i1", colorId: "r1" }])).toEqual({ itemId: "i1", colorId: "r1" });
  });
  it("dolu kumaş/renk ezilmez", () => {
    expect(orderLinePrefill({ itemId: "i1", colorId: "r9" }, [{ itemId: "i1", colorId: "r1" }])).toEqual({});
  });
  it("kalemler farklı renkteyse renk boş kalır; renksiz kalem renk yazmaz", () => {
    expect(orderLinePrefill({ itemId: "", colorId: "" }, [{ itemId: "i1", colorId: "r1" }, { itemId: "i1", colorId: "r2" }])).toEqual({ itemId: "i1" });
    expect(orderLinePrefill({ itemId: "", colorId: "" }, [{ itemId: "i1", colorId: null }])).toEqual({ itemId: "i1" });
  });
  it("boş seçim hiçbir şey yazmaz", () => {
    expect(orderLinePrefill({ itemId: "", colorId: "" }, [])).toEqual({});
  });
});

describe("beamPrefillForOrder", () => {
  it("çözgü kartı + fasoncu; hedef metre anahtarı YOK (kural: çevrim yapılmaz)", () => {
    const f = beamPrefillForOrder({ warpSpecId: "w1", subcontractorId: "s1" });
    expect(f).toEqual({ warpSpecId: "w1", executionKind: "SUBCONTRACTED", subcontractorId: "s1" });
    expect(f).not.toHaveProperty("plannedM");
  });
  it("fasoncusuz levent yalnız çözgü kartı yazar (kim dokuyor değişmez)", () => {
    expect(beamPrefillForOrder({ warpSpecId: "w1", subcontractorId: null })).toEqual({ warpSpecId: "w1" });
  });
});

describe("fabricSuggestionM", () => {
  it("take-up varken kumaş = çözgü × (1 − t/100), yuvarlanır; Decimal metin okunur", () => {
    expect(fabricSuggestionM(1000, "8")).toBe(920);
    expect(fabricSuggestionM("1500", 7.5)).toBe(1388);
    expect(fabricSuggestionM(1000, "0")).toBe(1000);
  });
  it("take-up yoksa/geçersizse öneri YOK (null)", () => {
    expect(fabricSuggestionM(1000, null)).toBeNull();
    expect(fabricSuggestionM(1000, "")).toBeNull();
    expect(fabricSuggestionM(1000, "100")).toBeNull();
    expect(fabricSuggestionM(0, "8")).toBeNull();
  });
});

describe("orderPrefillForBeam", () => {
  const WO = { warpSpecId: "w1", executionKind: "SUBCONTRACTED" as const, subcontractorId: "s1", notes: "tahar 4" };
  it("varsayılan köken (elle seçilmemiş) → fason sarım + fasoncu; çözgü kartı + not", () => {
    expect(orderPrefillForBeam(WO, { originKind: "IN_HOUSE", originTouched: false, supplierId: "", notes: "" })).toEqual({ warpSpecId: "w1", originKind: "SUBCONTRACT", subcontractorId: "s1", notes: "tahar 4" });
  });
  it("elle seçilmiş köken/dolu not ezilmez; emanet ve tedarikçili hazır leventte fasoncu yazılmaz", () => {
    expect(orderPrefillForBeam(WO, { originKind: "IN_HOUSE", originTouched: true, supplierId: "", notes: "benim notum" })).toEqual({ warpSpecId: "w1" });
    expect(orderPrefillForBeam(WO, { originKind: "CONSIGNED", originTouched: true, supplierId: "", notes: "" })).toEqual({ warpSpecId: "w1", notes: "tahar 4" });
    expect(orderPrefillForBeam(WO, { originKind: "PURCHASED", originTouched: true, supplierId: "c1", notes: "x" })).toEqual({ warpSpecId: "w1" });
    expect(orderPrefillForBeam(WO, { originKind: "PURCHASED", originTouched: true, supplierId: "", notes: "x" })).toEqual({ warpSpecId: "w1", subcontractorId: "s1" });
  });
  it("kendi tezgahında dokunan iş fasoncu yazmaz", () => {
    expect(orderPrefillForBeam({ ...WO, executionKind: "IN_HOUSE", subcontractorId: null }, { originKind: "IN_HOUSE", originTouched: false, supplierId: "", notes: "" })).toEqual({ warpSpecId: "w1", notes: "tahar 4" });
  });
});

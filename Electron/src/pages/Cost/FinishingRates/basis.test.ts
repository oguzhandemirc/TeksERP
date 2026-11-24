// SY-E1: kilo bazlı tarife panel aynası — backend `FinishingBasis` kümesiyle aynı, fiyat birimi tabana göre.
import { describe, expect, it } from "vitest";
import { FINISHING_BASIS_LABEL, buildFinishingRateBody, finishingBasisUnit } from "./service";

describe("tarife gövdesi (B15)", () => {
  const base = { code: "DEV", name: "Devere", subcontractorId: "s1", basis: "RAW_M" as const, currency: "TRY" as const, pricePerM: "1.5", typicalShrinkPct: null, note: null };
  it("hizmet kartı gövdeye girer; null da açıkça gider (köprüyü kaldırır)", () => {
    expect(buildFinishingRateBody({ ...base, serviceItemId: "h1" }).serviceItemId).toBe("h1");
    const nul = buildFinishingRateBody({ ...base, serviceItemId: null });
    expect("serviceItemId" in nul && nul.serviceItemId === null).toBe(true);
  });
});

describe("terbiye tarifesi tabanı", () => {
  it("backend kümesi birebir (RAW_M, FINISHED_M, KG)", () => {
    expect(Object.keys(FINISHING_BASIS_LABEL).sort()).toEqual(["FINISHED_M", "KG", "RAW_M"]);
  });
  it("KG fiyatı kilo başına, metre tabanları metre başına", () => {
    expect(finishingBasisUnit("KG")).toBe("kg");
    expect(finishingBasisUnit("RAW_M")).toBe("m");
    expect(finishingBasisUnit("FINISHED_M")).toBe("m");
  });
});

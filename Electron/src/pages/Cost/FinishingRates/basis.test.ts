// SY-E1: kilo bazlı tarife panel aynası — backend `FinishingBasis` kümesiyle aynı, fiyat birimi tabana göre.
import { describe, expect, it } from "vitest";
import { FINISHING_BASIS_LABEL, finishingBasisUnit } from "./service";

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

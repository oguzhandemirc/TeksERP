import { describe, expect, it } from "vitest";
import { isLooseUnit, loadUnitTitle } from "./load-unit";

describe("yük birimi adı", () => {
  it("dökme / araba / çuval / eski sunucu", () => {
    expect(loadUnitTitle({ unitKind: "BULK", sackNo: "CV1" })).toBe("Dökme");
    expect(loadUnitTitle({ unitKind: "CART", unitLabel: "A-12" })).toBe("Araba A-12");
    expect(loadUnitTitle({ unitKind: "SACK", sackNo: "CV3" })).toBe("CV3");
    expect(loadUnitTitle({ sackNo: "CV4" })).toBe("CV4");
    expect(isLooseUnit({ unitKind: "CART" })).toBe(true);
    expect(isLooseUnit({})).toBe(false);
  });
});

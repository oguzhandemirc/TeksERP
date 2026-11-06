import { describe, expect, it } from "vitest";
import { isLooseUnit, loadKgSuffix, loadSummaryValue, loadUnitTitle, loadUnitsText } from "./load-unit";

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

describe("loadUnitsText / loadKgSuffix", () => {
  it("eski sunucu (alan yok) → hepsi çuval", () => {
    expect(loadUnitsText(3)).toBe("3 çuval");
    expect(loadKgSuffix(3)).toBe("all");
  });
  it("araba ve dökme ayrı söylenir; kg çuvallarındır", () => {
    expect(loadUnitsText(2, 2, 0)).toBe("2 araba");
    expect(loadUnitsText(1, 0, 1)).toBe("Dökme");
    expect(loadUnitsText(3, 2, 0)).toBe("1 çuval · 2 araba");
    expect(loadKgSuffix(2, 2, 0)).toBe("none");
    expect(loadKgSuffix(3, 2, 0)).toBe("sacks-only");
  });
});

describe("loadSummaryValue", () => {
  it("çuvalsız yükte kg yazılmaz", () => {
    expect(loadSummaryValue(2, "0", 2, 0)).toBe("2 araba");
    expect(loadSummaryValue(3, "96,7")).toBe("3 çuval · 96,7 kg");
    expect(loadSummaryValue(3, "12", 2, 0)).toBe("1 çuval · 2 araba · 12 kg (çuvallar)");
  });
});

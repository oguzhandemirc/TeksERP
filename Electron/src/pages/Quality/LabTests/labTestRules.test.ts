import { describe, expect, it } from "vitest";
import { formatScaleValue, parseDecimalInput, resultValueText, specRangeText, specSource, withinSpec } from "./labTestRules";

describe("lab görünüm kuralları", () => {
  it("gri ölçek yarım adımı '4-5' basar, tam sayıyı olduğu gibi (backend aynası)", () => {
    expect(formatScaleValue(4.5)).toBe("4-5");
    expect(formatScaleValue(3)).toBe("3");
    expect(resultValueText({ resultKind: "SCALE", value: "4.500", unit: null, verdict: "PASS" })).toBe("4-5");
  });
  it("sayısal değer birimiyle, PASS_FAIL hükümle yazılır", () => {
    expect(resultValueText({ resultKind: "NUMERIC", value: "210.000", unit: "g/m²", verdict: "PASS" })).toBe("210 g/m²");
    expect(resultValueText({ resultKind: "PASS_FAIL", value: null, unit: null, verdict: "FAIL" })).toBe("Kaldı");
  });
  it("sınır metni ve sınır içi/dışı karşılaştırması", () => {
    expect(specRangeText("200", "220", "NUMERIC")).toBe("200–220");
    expect(specRangeText("4", null, "SCALE")).toBe("≥ 4");
    expect(specRangeText(null, null, "NUMERIC")).toBeNull();
    expect(withinSpec({ resultKind: "NUMERIC", value: "230", specMin: "200", specMax: "220" })).toBe(false);
    expect(withinSpec({ resultKind: "NUMERIC", value: "220", specMin: "200", specMax: "220" })).toBe(true);
    expect(withinSpec({ resultKind: "PASS_FAIL", value: null, specMin: null, specMax: null })).toBeNull();
  });
  it("türün varsayılanından farklı sınır müşteri spesifikasyonudur", () => {
    const type = { specMin: "200.000", specMax: "220.000" };
    expect(specSource({ specMin: "200", specMax: "220" }, type)).toBe("TYPE");
    expect(specSource({ specMin: "225", specMax: "240" }, type)).toBe("CUSTOMER");
    expect(specSource({ specMin: null, specMax: null }, type)).toBe("NONE");
  });
  it("virgüllü giriş sayıya çevrilir, bozuk giriş NaN", () => {
    expect(parseDecimalInput("4,5")).toBe(4.5);
    expect(parseDecimalInput(" ")).toBeNull();
    expect(Number.isNaN(parseDecimalInput("4,5,1"))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { fromUnitSettings, toUnitSettings, unitExample } from "./unit-settings";

describe("etiket birim sistemi seçici modeli", () => {
  it("bugünkü biçim null kaydedilir (bayt-aynı)", () => {
    expect(toUnitSettings("METRIC", "auto", ",")).toBeNull();
  });
  it("ABD + 1 ondalık + nokta", () => {
    expect(toUnitSettings("US", "1", ".")).toEqual({ system: "US", decimals: 1, decimalSep: "." });
  });
  it("metrik ama sabit ondalık → kaydedilir", () => {
    expect(toUnitSettings("METRIC", "2", ",")).toEqual({ system: "METRIC", decimals: 2, decimalSep: null });
  });
  it("gidiş-dönüş", () => {
    const s = toUnitSettings("BOTH", "3", ",");
    expect(fromUnitSettings(s)).toEqual({ system: "BOTH", decimals: "3", sep: "," });
    expect(fromUnitSettings(null)).toEqual({ system: "METRIC", decimals: "auto", sep: "," });
  });
  it("örnek metin: ikisi yan yana", () => {
    expect(unitExample(null)).toBe("150 cm");
    expect(unitExample({ system: "US" })).toBe("59,06 in");
    expect(unitExample({ system: "BOTH" })).toBe("150 cm / 59,06 in");
    expect(unitExample({ system: "US", decimals: 0 })).toBe("59 in");
  });
});

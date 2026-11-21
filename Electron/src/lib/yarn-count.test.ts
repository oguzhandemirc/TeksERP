import { describe, expect, it } from "vitest";
import { denierSuggestionFromName, formatDenierText, parseLooseNumber, toDenier } from "./yarn-count";

describe("toDenier — fiziksel sabitler", () => {
  it("dtex × 0,9", () => expect(toDenier(167, "DTEX")).toBeCloseTo(150.3, 6));
  it("9000 ÷ Nm", () => expect(toDenier(60, "NM")).toBeCloseTo(150, 6));
  it("5314,88 ÷ Ne", () => expect(toDenier(30, "NE")).toBeCloseTo(177.1627, 4));
  it("g/m × 9000", () => expect(toDenier(0.0167, "G_PER_M")).toBeCloseTo(150.3, 6));
  it("sıfır/negatif/NaN → null", () => {
    expect(toDenier(0, "NM")).toBeNull();
    expect(toDenier(-1, "DTEX")).toBeNull();
    expect(toDenier(NaN, "NE")).toBeNull();
  });
});

describe("biçim", () => {
  it("en çok 4 hane, sondaki sıfırsız, nokta ondalık", () => {
    expect(formatDenierText(177.16266666)).toBe("177.1627");
    expect(formatDenierText(150)).toBe("150");
  });
  it("virgüllü metin okunur", () => expect(parseLooseNumber("1,5")).toBe(1.5));
});

describe("addan denye önerisi (sessiz atama yok — yalnız öneri)", () => {
  it("açık DN eki önce gelir", () => expect(denierSuggestionFromName("600 KAR İPİ 70 DN")).toBe("70"));
  it("ek yoksa addaki ilk sayı", () => expect(denierSuggestionFromName("600 KAR İPİ")).toBe("600"));
  it("150D tekstüre", () => expect(denierSuggestionFromName("150D TEKSTÜRE")).toBe("150"));
  it("sayı yoksa null", () => expect(denierSuggestionFromName("PUL")).toBeNull());
  it("DN harf öneki kelimeyi yutmaz (DENİZ)", () => expect(denierSuggestionFromName("5 DENİZ 300")).toBe("5"));
});

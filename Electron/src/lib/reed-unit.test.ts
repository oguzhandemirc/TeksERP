// Tarak birimi tek çeviri noktası (K9): saklama diş/10 cm; diş/cm ayarında ÷10 gösterim, ×10 giriş.
import { describe, expect, it } from "vitest";
import { formatReedNo, reedDentsPerCm, reedDisplayNumber, reedFromInput, reedToDisplay, reedUnitLabel } from "./reed-unit";

describe("reed-unit", () => {
  it("varsayılan birimde değer aynen geçer (bugünkü davranış)", () => {
    expect(reedToDisplay(100, "DENTS_PER_10CM")).toBe("100");
    expect(reedToDisplay("12.50", "DENTS_PER_10CM")).toBe("12.50");
    expect(reedFromInput(" 100 ", "DENTS_PER_10CM")).toBe("100");
    expect(reedDisplayNumber("100", "DENTS_PER_10CM")).toBe(100);
    expect(reedUnitLabel("DENTS_PER_10CM")).toBe("diş/10 cm");
  });
  it("diş/cm: gösterim ÷10, giriş ×10 (Decimal 2 hane)", () => {
    expect(reedToDisplay(100, "DENTS_PER_CM")).toBe("10");
    expect(reedToDisplay("125.5", "DENTS_PER_CM")).toBe("12.55");
    expect(reedFromInput("10", "DENTS_PER_CM")).toBe("100");
    expect(reedFromInput("12,55", "DENTS_PER_CM")).toBe("125.5");
    expect(reedFromInput("0.1", "DENTS_PER_CM")).toBe("1");
    expect(reedDisplayNumber(85, "DENTS_PER_CM")).toBe(8.5);
    expect(reedUnitLabel("DENTS_PER_CM")).toBe("diş/cm");
  });
  it("gidiş-dönüş kaybı yok", () => {
    for (const s of ["100", "125.5", "7.25", "9999.99"]) expect(reedFromInput(reedToDisplay(s, "DENTS_PER_CM"), "DENTS_PER_CM")).toBe(String(Number(s)));
  });
  it("boş/null → boş; çöp girişi aynen bırakılır (şema reddeder)", () => {
    expect(reedToDisplay(null, "DENTS_PER_CM")).toBe("");
    expect(reedFromInput("", "DENTS_PER_CM")).toBeNull();
    expect(reedFromInput("abc", "DENTS_PER_CM")).toBe("abc");
  });
  it("liste/basım metni firma biriminde", () => {
    expect(formatReedNo("100", "DENTS_PER_10CM")).toBe("100");
    expect(formatReedNo(125.5, "DENTS_PER_CM")).toBe("12,55");
    expect(formatReedNo(null, "DENTS_PER_CM")).toBeNull();
  });
  it("taraktan tel önerisi için diş/cm", () => {
    expect(reedDentsPerCm("100", "DENTS_PER_10CM")).toBe(10);
    expect(reedDentsPerCm("10", "DENTS_PER_CM")).toBe(10);
    expect(reedDentsPerCm("", "DENTS_PER_CM")).toBeNull();
  });
});

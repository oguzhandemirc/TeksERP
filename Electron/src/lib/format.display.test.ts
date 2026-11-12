import { describe, expect, it } from "vitest";
import { formatDisplay, formatMeasure, formatMoney, formatNumber, formatPercent } from "./format";

describe("gösterim sayısı (binlik ayracı yok, ondalık virgül)", () => {
  it("tam sayıda gruplamasız, hanesiz", () => {
    expect(formatDisplay(4295)).toBe("4295");
    expect(formatMeasure(4295, "m")).toBe("4295 m");
    expect(formatMeasure(10500, "kg")).toBe("10500 kg");
    expect(formatDisplay(1234567)).toBe("1234567");
  });
  it("metre/kg en çok 1 hane", () => {
    expect(formatMeasure(4295.46, "m")).toBe("4295,5 m");
    expect(formatMeasure(12.04, "m")).toBe("12 m");
  });
  it("para hep 2 hane", () => {
    expect(formatMoney(325684.9, "TRY")).toBe("325684,90 TRY");
    expect(formatMoney(0, "USD")).toBe("0,00 USD");
    expect(formatMoney(1500)).toBe("1500,00");
  });
  it("yüzde ön ekli", () => {
    expect(formatPercent(12.54)).toBe("%12,5");
  });
  it("boş/geçersiz → yedek", () => {
    expect(formatDisplay(null)).toBe("—");
    expect(formatMoney("x")).toBe("—");
    expect(formatMeasure(undefined, "m", 1, "")).toBe("");
    expect(formatDisplay(-0.01, 0)).toBe("0");
  });
  it("tablo biçimi (formatNumber) gruplamasız kalır", () => {
    expect(formatNumber(4295, 0)).toBe("4295");
  });
});

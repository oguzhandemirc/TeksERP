// Sayı biçimi kuralı (kullanıcı 2026-11-12): para binlik ayırıcılı, ölçü/sayım/yüzde ayırıcısız.
// Negatif sonda: `formatter`daki gruplama bayrağı tersine çevrilince (ya da sabitlenince) kırmızı.
import { describe, expect, it } from "vitest";
import { amountFormatter, formatAmount, formatDisplay, formatFixed, formatMeasure, formatMoney, formatNumber, formatPercent, formatQty, qtyFormatter } from "./format";

describe("sayı biçimi kuralı — birim sınıfı", () => {
  it("⭐ para gruplu, 2 hane", () => {
    expect(formatMoney(325684.9, "TRY")).toBe("325.684,90 TRY");
    expect(formatMoney(1234567890.126)).toBe("1.234.567.890,13");
    expect(formatMoney(-12500.5, "EUR")).toBe("-12.500,50 EUR");
    expect(formatMoney(999.999)).toBe("1.000,00");
    expect(formatAmount(0)).toBe("0,00");
    expect(formatAmount(-0.001)).toBe("0,00");
    expect(formatAmount(1234.56789, 2, 4)).toBe("1.234,5679");
    expect(amountFormatter().format(10500)).toBe("10.500,00");
  });
  it("⭐ ölçü/sayım/yüzde grupsuz", () => {
    expect(formatMeasure(14700, "m")).toBe("14700 m");
    expect(formatMeasure(10500.25, "kg")).toBe("10500,3 kg");
    expect(formatMeasure(-1234.5, "m")).toBe("-1234,5 m");
    expect(formatDisplay(1234567890)).toBe("1234567890");
    expect(formatDisplay(0)).toBe("0");
    expect(formatDisplay(-0.01)).toBe("0");
    expect(formatNumber(98765.4321)).toBe("98765,43");
    expect(formatFixed(12000, 2)).toBe("12000,00");
    expect(formatQty(1250.5)).toBe("1250,5");
    expect(formatQty(2, 3, 2)).toBe("2,00");
    expect(formatQty(1000.12345)).toBe("1000,123");
    expect(formatPercent(1234.56)).toBe("%1234,6");
    expect(qtyFormatter(1).format(10500)).toBe("10500");
  });
  it("sayı olmayan değer yedek metne düşer", () => {
    expect(formatQty(null)).toBe("—");
    expect(formatAmount(Number.NaN)).toBe("—");
    expect(formatMoney(undefined, "TRY", "")).toBe("");
  });
});

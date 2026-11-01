// Sevkiyatlar listesi metrajı irsaliye ile aynı iki haneli biçimde (Gülkesim prova: 240 m ↔ 239,50 m).
import { describe, expect, it } from "vitest";
import { formatFixed } from "./format";

describe("formatFixed", () => {
  it("metrajı iki sabit ondalıkla, virgülle, binlik ayıracısız basar", () => {
    expect(formatFixed(239.5)).toBe("239,50");
    expect(formatFixed(240)).toBe("240,00");
    expect(formatFixed(1239.25)).toBe("1239,25");
    expect(formatFixed("12.3")).toBe("12,30");
  });
  it("boş/geçersiz → —", () => {
    expect(formatFixed(null)).toBe("—");
    expect(formatFixed("abc")).toBe("—");
  });
});

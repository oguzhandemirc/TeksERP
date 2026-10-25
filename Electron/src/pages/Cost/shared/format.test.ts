import { describe, expect, it } from "vitest";
import { ageDays, decToInput, fmtDec, fmtDecFull, fmtPct, toDecimalText } from "./format";

describe("maliyet sunum biçimi — sunucu sayısı DEĞİŞMEZ, yalnız TR biçimi", () => {
  it("plan §2.3 altın değer 77.0395 → 77,04 (gösterim hanesi)", () => {
    expect(fmtDec("77.0395")).toBe("77,04");
    expect(fmtDecFull("77.0395")).toBe("77,0395");
  });
  it("metin TAM ondalık biçimlenir — float yuvarlama sapması yok (1.005 → 1,01)", () => {
    // Number(1.005).toFixed(2) === "1.00" olurdu; string girdi Intl'e tam ondalık gider.
    expect(fmtDec("1.005")).toBe("1,01");
  });
  it("binlik ayraç ve boş değer", () => {
    expect(fmtDec("1234.5")).toBe("1.234,50");
    expect(fmtDec(null)).toBe("—");
    expect(fmtPct("6.00")).toBe("%6");
  });
  it("form ↔ Decimal metni sayıya çevrilmeden", () => {
    expect(toDecimalText("1.234,5")).toBe("1234.5");
    expect(toDecimalText("18,00")).toBe("18.00");
    expect(toDecimalText("  ")).toBeNull();
    expect(decToInput("18.0000")).toBe("18");
    expect(decToInput("2.6000")).toBe("2,6");
  });
  it("fiyat yaşı gün olarak", () => {
    expect(ageDays("2026-07-01T00:00:00Z", new Date("2026-10-01T00:00:00Z"))).toBe(92);
  });
});

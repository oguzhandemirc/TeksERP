import { describe, it, expect } from "vitest";
import { hoursPresetsUpTo, minutesToLabel } from "./duration";

describe("hoursPresetsUpTo", () => {
  it("mobil kilit sınırı (120 dk) → yalnız 1 ve 2 saat", () => {
    expect(hoursPresetsUpTo(120)).toEqual([1, 2]);
  });
  it("1 saatten kısa max → boş liste", () => {
    expect(hoursPresetsUpTo(59)).toEqual([]);
    expect(hoursPresetsUpTo(0)).toEqual([]);
  });
  it("tam 60 dk → [1]", () => {
    expect(hoursPresetsUpTo(60)).toEqual([1]);
  });
  it("panel/saha idle sınırı (1440 dk) → 1..24", () => {
    const p = hoursPresetsUpTo(1440);
    expect(p).toHaveLength(24);
    expect(p[0]).toBe(1);
    expect(p[23]).toBe(24);
  });
  it("oturum sınırı (43200 dk) → saat listesi 24'te durur", () => {
    expect(hoursPresetsUpTo(43200)).toHaveLength(24);
    expect(hoursPresetsUpTo(43200).at(-1)).toBe(24);
  });
  it("125 dk → [1, 2] (yalnız tam sığan saatler)", () => {
    expect(hoursPresetsUpTo(125)).toEqual([1, 2]);
  });
});

describe("minutesToLabel", () => {
  it("tam saat → 'N saat'", () => {
    expect(minutesToLabel(60)).toBe("1 saat");
    expect(minutesToLabel(1440)).toBe("24 saat");
    expect(minutesToLabel(480)).toBe("8 saat");
  });
  it("saatten kısa → 'N dakika'", () => {
    expect(minutesToLabel(45)).toBe("45 dakika");
    expect(minutesToLabel(1)).toBe("1 dakika");
  });
  it("saat + dakika → 'H sa M dk'", () => {
    expect(minutesToLabel(90)).toBe("1 sa 30 dk");
    expect(minutesToLabel(125)).toBe("2 sa 5 dk");
  });
  it("sıfır/negatif/geçersiz → '0 dakika'", () => {
    expect(minutesToLabel(0)).toBe("0 dakika");
    expect(minutesToLabel(-10)).toBe("0 dakika");
    expect(minutesToLabel(NaN)).toBe("0 dakika");
    expect(minutesToLabel(Infinity)).toBe("0 dakika");
  });
});

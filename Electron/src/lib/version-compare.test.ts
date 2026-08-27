import { describe, it, expect } from "vitest";
import { compareVersions, isBelowMinimum } from "./version-compare";

describe("sürüm karşılaştırma", () => {
  it("temel sıralama", () => {
    expect(compareVersions("2.8.1", "2.8.1")).toBe(0);
    expect(compareVersions("2.8.0", "2.8.1")).toBeLessThan(0);
    expect(compareVersions("2.9.0", "2.8.1")).toBeGreaterThan(0);
    expect(compareVersions("3.0.0", "2.99.99")).toBeGreaterThan(0);
  });

  it("SAYISAL karşılaştırır — sözlüksel değil", () => {
    // Sözlüksel karşılaştırma "2.10.0" < "2.9.0" derdi ve kilit, bir sonraki
    // ondalık atlamada sessizce ters çalışırdı.
    expect(compareVersions("2.10.0", "2.9.0")).toBeGreaterThan(0);
    expect(compareVersions("2.9.0", "2.10.0")).toBeLessThan(0);
    expect(compareVersions("10.0.0", "9.0.0")).toBeGreaterThan(0);
  });

  it("eksik parça 0 sayılır", () => {
    expect(compareVersions("2.8", "2.8.0")).toBe(0);
    expect(compareVersions("2", "2.0.1")).toBeLessThan(0);
  });

  it("bozuk girdi kilit ÜRETMEZ (fail-open)", () => {
    expect(isBelowMinimum("", "2.8.1")).toBe(false);
    expect(isBelowMinimum("2.8.0", "")).toBe(false);
    expect(isBelowMinimum(null, "2.8.1")).toBe(false);
    expect(isBelowMinimum("2.8.0", undefined)).toBe(false);
    // Anlaşılmayan metin 0.0.0 gibi davranır ama iki taraf da bozuksa eşittir.
    expect(isBelowMinimum("abc", "def")).toBe(false);
  });

  it("gerçek kilit senaryosu", () => {
    expect(isBelowMinimum("2.8.0", "2.8.1")).toBe(true);
    expect(isBelowMinimum("2.8.1", "2.8.1")).toBe(false);
    expect(isBelowMinimum("2.9.0", "2.8.1")).toBe(false);
  });
});

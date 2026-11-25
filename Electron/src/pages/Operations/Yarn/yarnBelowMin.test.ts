// İplik Stoğu "Asgari altı" filtresi: varsayılan kapalı, seçilince filtre kirli sayılır, boş liste cümlesi
// süzgeci ADIYLA söyler ("bakiyesi olan iplik yok" demez — sıfır bakiye bu süzgeçte zaten görünür).
// Negatif sonda: `yarnEmptyStateMessage`teki belowMin dalı sökülünce §2 kırmızı.
import { describe, expect, it } from "vitest";
import { EMPTY_YARN_FILTERS, isYarnFilterDirty, yarnEmptyStateMessage } from "./YarnFilterBar";

describe("İplik Stoğu asgari altı filtresi", () => {
  it("§1 varsayılan kapalı; seçilince kirli", () => {
    expect(EMPTY_YARN_FILTERS.belowMin).toBe(false);
    expect(isYarnFilterDirty(EMPTY_YARN_FILTERS)).toBe(false);
    expect(isYarnFilterDirty({ ...EMPTY_YARN_FILTERS, belowMin: true })).toBe(true);
  });

  it("§2 boş liste cümlesi asgari stoktan söz eder", () => {
    expect(yarnEmptyStateMessage({ ...EMPTY_YARN_FILTERS, belowMin: true })).toMatch(/^Asgari stoğun altına düşen iplik yok/);
    expect(yarnEmptyStateMessage({ ...EMPTY_YARN_FILTERS, belowMin: true, search: "pes" })).toBe("Bu filtreyle asgari stoğun altına düşen iplik yok.");
  });
});

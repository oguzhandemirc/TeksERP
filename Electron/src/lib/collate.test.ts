import { describe, it, expect } from "vitest";
import { trCompare } from "./collate";
import { foldSearchText } from "./search-fold";

describe("Türkçe sıralama", () => {
  it("Ç bütün C'lerden SONRA gelir", () => {
    const sorted = ["Ceyhan", "Çanakkale", "Cebeci"].sort(trCompare);
    expect(sorted).toEqual(["Cebeci", "Ceyhan", "Çanakkale"]);
  });

  it("I ile İ ayrı harflerdir (I önce)", () => {
    expect(["İnci", "Işık"].sort(trCompare)).toEqual(["Işık", "İnci"]);
  });

  it("sayısal parçalar sayı gibi sıralanır (SIP-2 < SIP-10)", () => {
    expect(["SIP-10", "SIP-2", "SIP-1"].sort(trCompare)).toEqual(["SIP-1", "SIP-2", "SIP-10"]);
  });

  it("SIRALAMA ile ARAMA ters araçlardır — karıştırılmamalı", () => {
    // Katlama Ç'yi C'ye indirir → "Çanakkale" C'lerin ÖNÜNE düşer (yanlış sıra).
    const byFold = ["Ceyhan", "Çanakkale", "Cebeci"].sort((a, b) =>
      foldSearchText(a) < foldSearchText(b) ? -1 : 1,
    );
    expect(byFold[0]).toBe("Çanakkale");
    expect(["Ceyhan", "Çanakkale", "Cebeci"].sort(trCompare)[0]).toBe("Cebeci");
  });

  it("null/undefined çökmez", () => {
    expect(trCompare(null, undefined)).toBe(0);
    expect(trCompare("a", null)).toBeGreaterThan(0);
  });
});

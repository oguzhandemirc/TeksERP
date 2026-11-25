import { describe, expect, it } from "vitest";
import type { ItemPriceRow } from "@/pages/Definitions/ItemPrices/service";
import { anyCommercialSection, commercialSections, specRangeText, summarizeItemPrices } from "./itemCommercial";

const row = (o: Partial<ItemPriceRow>): ItemPriceRow => ({ id: "x", itemId: "i", customerId: null, kind: "SALE", currency: "TRY", price: "10", createdAt: "", updatedAt: "", ...o });

describe("summarizeItemPrices", () => {
  it("(yön, para birimi) başına varsayılan + istisna sayısı; satış önce, para birimi sabit sırada", () => {
    const out = summarizeItemPrices([
      row({ kind: "PURCHASE", currency: "USD", price: "3" }),
      row({ currency: "USD", price: "5" }),
      row({ currency: "TRY", customerId: "c1", price: "9" }),
      row({ currency: "TRY", price: "10" }),
    ]);
    expect(out.map((l) => `${l.kind}:${l.currency}`)).toEqual(["SALE:TRY", "SALE:USD", "PURCHASE:USD"]);
    expect(out[0]).toMatchObject({ defaultPrice: "10", exceptions: 1 });
  });
  it("yalnız müşteri istisnası varsa varsayılan null (sıfır değil)", () => {
    expect(summarizeItemPrices([row({ customerId: "c1" })])[0]).toMatchObject({ defaultPrice: null, exceptions: 1 });
  });
});

describe("commercialSections", () => {
  const all = { prices: true, supplierCodes: true, labSpecs: true, ruleSets: true };
  it("tedarikçi kodu yalnız iplikte, kalite bağlantıları yalnız kumaşta", () => {
    expect(commercialSections("YARN", all)).toEqual({ prices: true, supplierCodes: true, labSpecs: false, ruleSets: false });
    expect(commercialSections("FABRIC", all)).toEqual({ prices: true, supplierCodes: false, labSpecs: true, ruleSets: true });
    expect(commercialSections("SUPPLY", all)).toEqual({ prices: true, supplierCodes: false, labSpecs: false, ruleSets: false });
  });
  it("erişim yoksa sekme yok", () => {
    expect(anyCommercialSection(commercialSections("SUPPLY", { prices: false, supplierCodes: true, labSpecs: true, ruleSets: true }))).toBe(false);
  });
});

describe("specRangeText", () => {
  it("iki sınır · tek sınır · sınırsız", () => {
    expect(specRangeText({ specMin: "12.5", specMax: "18", testType: { unit: "N" } })).toBe("12,5 – 18 N");
    expect(specRangeText({ specMin: 12, specMax: null, testType: { unit: null } })).toBe("≥ 12");
    expect(specRangeText({ specMin: null, specMax: "4", testType: { unit: "%" } })).toBe("≤ 4 %");
    expect(specRangeText({ specMin: null, specMax: null, testType: { unit: "N" } })).toBe("—");
  });
});

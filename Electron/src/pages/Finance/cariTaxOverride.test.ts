// BEKÇİ — D4-V1k cari KDV / tevkifat saf form katmanı (boş = genel ayar; yarım oran yok; 1 ≤ pay ≤ payda ≤ 99).
import { describe, expect, it } from "vitest";
import { buildTaxOverrideBody, parseVatRate, parseWithholdingRatio } from "./cariTaxOverride";

describe("parseVatRate", () => {
  it("boş → null (genel ayar); virgül noktaya döner; % işareti kabul", () => {
    expect(parseVatRate("")).toBeNull();
    expect(parseVatRate("1,5")).toBe("1.5");
    expect(parseVatRate("%20")).toBe("20");
    expect(parseVatRate("0")).toBe("0");
  });
  it("aralık dışı / biçimsiz → undefined", () => {
    expect(parseVatRate("101")).toBeUndefined();
    expect(parseVatRate("-1")).toBeUndefined();
    expect(parseVatRate("yirmi")).toBeUndefined();
    expect(parseVatRate("1.234")).toBeUndefined();
  });
});

describe("parseWithholdingRatio", () => {
  it("5/10 ve boşluklu yazım", () => {
    expect(parseWithholdingRatio("5/10")).toEqual({ numerator: 5, denominator: 10 });
    expect(parseWithholdingRatio(" 7 / 10 ")).toEqual({ numerator: 7, denominator: 10 });
    expect(parseWithholdingRatio("")).toBeNull();
  });
  it("pay > payda, pay 0, tek sayı, yüzde → undefined", () => {
    expect(parseWithholdingRatio("11/10")).toBeUndefined();
    expect(parseWithholdingRatio("0/10")).toBeUndefined();
    expect(parseWithholdingRatio("5")).toBeUndefined();
    expect(parseWithholdingRatio("50%")).toBeUndefined();
  });
});

describe("buildTaxOverrideBody", () => {
  it("genel ayar seçimi → hepsi null", () => {
    expect(buildTaxOverrideBody({ vatRate: "", withholding: "FACTORY", ratio: "" })).toEqual({
      ok: true,
      body: { vatRate: null, withholdingEnabled: null, withholdingNumerator: null, withholdingDenominator: null },
    });
  });
  it("uygulanmaz → false; oran boş olabilir", () => {
    const r = buildTaxOverrideBody({ vatRate: "10", withholding: "NONE", ratio: "" });
    expect(r).toEqual({ ok: true, body: { vatRate: "10", withholdingEnabled: false, withholdingNumerator: null, withholdingDenominator: null } });
  });
  it("hatalı KDV ya da oran → ok:false + Türkçe ileti", () => {
    const a = buildTaxOverrideBody({ vatRate: "150", withholding: "FACTORY", ratio: "" });
    expect(a.ok).toBe(false);
    const b = buildTaxOverrideBody({ vatRate: "", withholding: "APPLY", ratio: "abc" });
    expect(b.ok === false && b.error.includes("pay/payda")).toBe(true);
  });
});

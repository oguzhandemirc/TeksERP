// Saf kurallar: kesin fiyat 2 hane, kalem gövdesi (ürün XOR yeni desen; boş fiyat gönderilmez → sunucu önerir),
// liste süzgeci SUNUCUYA parametre, başlık gövdesinde kur yalnız değişince, maliyet sütunu yalnız alan varsa.
import { describe, expect, it } from "vitest";
import { emptyCalculator } from "../Calculator/calculator-body";
import { buildLineBody, emptyLineForm } from "./line-body";
import { hasCostColumns } from "./line-columns";
import { checkUnitPrice, samePriceText } from "./price-input";
import { buildHeaderBody, EMPTY_HEADER, quoteListParams } from "./service";
import { EMPTY_QUOTE_FILTER } from "./quote-types";

describe("kesin birim fiyat (2 hane)", () => {
  it("TR yazımı kabul, 3 hane reddedilir, sayıya çevrilmez", () => {
    expect(checkUnitPrice("2,67")).toEqual({ ok: true, text: "2.67" });
    expect(checkUnitPrice("1.234,5")).toEqual({ ok: true, text: "1234.5" });
    expect(checkUnitPrice("2,675")).toEqual({ ok: false, error: "Birim fiyat en çok 2 ondalık hane olabilir." });
    expect(checkUnitPrice("abc").ok).toBe(false);
    expect(checkUnitPrice("").ok).toBe(false);
    expect(samePriceText("2.70", "2.7")).toBe(true);
    expect(samePriceText("2.67", "2.68")).toBe(false);
  });
});

describe("kalem gövdesi", () => {
  it("ürün kalemi: itemId + miktar; fiyat boşsa unitPrice YOK (sunucu önerir)", () => {
    const f = { ...emptyLineForm(), item: { id: "i1", code: "K1", name: "Kristal" }, quantity: "5000", colorId: "c1" };
    expect(buildLineBody(f)).toEqual({ itemId: "i1", quantity: "5000", colorId: "c1" });
    expect(buildLineBody({ ...f, unitPrice: "2,67" })).toMatchObject({ unitPrice: "2.67" });
  });
  it("varyant yalnız ürünlü kalemde gider; yeni desende gönderilmez", () => {
    const f = { ...emptyLineForm(), item: { id: "i1", code: "K1", name: "Kristal" }, quantity: "10", recipeId: "r1" };
    expect(buildLineBody(f)).toMatchObject({ itemId: "i1", recipeId: "r1" });
    const adHocBodyOut = buildLineBody({ ...f, mode: "adHoc", adHoc: { ...emptyCalculator().adHoc, endsCount: "5200" }, description: "X" });
    expect(adHocBodyOut).not.toBeNull();
    expect(adHocBodyOut).not.toHaveProperty("recipeId");
  });
  it("yeni desen: elle yapı + ad zorunlu, itemId gönderilmez; miktarsız kalem gönderilmez", () => {
    const adHoc = { ...emptyCalculator().adHoc, endsCount: "5200" };
    const f = { ...emptyLineForm({ mode: "adHoc", adHoc, rateCode: "" }), quantity: "2000" };
    expect(buildLineBody(f)).toBeNull();
    const body = buildLineBody({ ...f, description: "Sahra yeni" });
    expect(body).toMatchObject({ adHoc: { warp: { endsCount: "5200" } }, description: "Sahra yeni", quantity: "2000" });
    expect(body).not.toHaveProperty("itemId");
    expect(buildLineBody({ ...f, description: "x", quantity: "" })).toBeNull();
  });
});

describe("liste parametreleri ve başlık gövdesi", () => {
  it("süzgeçler sunucuya gider (durum, müşteri, süresi dolan, tarih, cursor)", () => {
    const p = quoteListParams({ ...EMPTY_QUOTE_FILTER, status: "SENT", customerId: "c1", expired: true, from: "2026-10-01", to: "2026-10-25" }, "abc", 50);
    expect(p).toEqual({ "filter[durum]": "SENT", "filter[customerId]": "c1", "filter[suresiDoldu]": "1", from: "2026-10-01", to: "2026-10-25", cursor: "abc", limit: "50" });
  });
  it("TL teklifte kur gitmez; düzenlemede kur yalnız değiştiyse gider (değişmeyen öneri 'elle' damgalanmasın)", () => {
    expect(buildHeaderBody({ ...EMPTY_HEADER, customerId: "c1", fxRate: "35" }, "create")).not.toHaveProperty("fxRate");
    const saved = { ...EMPTY_HEADER, customerId: "c1", currency: "USD" as const, fxRate: "34,5" };
    expect(buildHeaderBody({ ...saved, notes: "x" }, "update", saved)).not.toHaveProperty("fxRate");
    expect(buildHeaderBody({ ...saved, fxRate: "35" }, "update", saved)).toMatchObject({ fxRate: "35" });
    expect(buildHeaderBody(saved, "update", saved)).not.toHaveProperty("customerId");
  });
});

describe("maliyet sütunu görünürlüğü", () => {
  it("alan yanıtta yoksa (cost:read yok) sütun yok", () => {
    expect(hasCostColumns([{ unitPrice: "2.67" }])).toBe(false);
    expect(hasCostColumns([{ unitPrice: "2.67", costPerMTry: "2.2659" }])).toBe(true);
  });
});

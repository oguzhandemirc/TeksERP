// Gövde/parametre kurucuları: kapsam süzgeci sunucuya doğru anahtarla gider; fiyatı boş satır gönderilmez;
// TL listede kur gönderilmez; boş kâr = parametre (alan gitmez).
import { describe, expect, it } from "vitest";
import { EMPTY_PRICE_LIST_FILTER } from "./pl-types";
import { buildFillBody, buildLinesBody, priceListParams } from "./service";

const item = { id: "i1", code: "K1", name: "Kumaş" };

describe("fiyat listesi gövdeleri", () => {
  it("kapsam: genel → filter[genel]=1; müşteri → filter[customerId]; durum + döviz", () => {
    expect(priceListParams({ ...EMPTY_PRICE_LIST_FILTER, scope: "genel", status: "PUBLISHED", currency: "USD" }, null, 50)).toEqual({
      "filter[genel]": "1", "filter[durum]": "PUBLISHED", "filter[currency]": "USD", limit: "50",
    });
    expect(priceListParams({ ...EMPTY_PRICE_LIST_FILTER, scope: "customer", customerId: "c1" }, "cur", 5)).toEqual({ "filter[customerId]": "c1", cursor: "cur", limit: "5" });
    expect(priceListParams({ ...EMPTY_PRICE_LIST_FILTER, scope: "customer" }, null, 5)).toEqual({ limit: "5" });
  });
  it("satırlar: fiyatı boş satır varsa null; TR yazımı sunucu metnine; boş asgari miktar gitmez", () => {
    expect(buildLinesBody([{ key: "a", item, colorId: null, unitPrice: "", minQty: "" }])).toBeNull();
    expect(buildLinesBody([{ key: "a", item, colorId: "r1", unitPrice: "12,5", minQty: "" }])).toEqual([{ itemId: "i1", colorId: "r1", unitPrice: "12.5" }]);
    expect(buildLinesBody([{ key: "a", item, colorId: null, unitPrice: "3", minQty: "100" }])).toEqual([{ itemId: "i1", colorId: null, unitPrice: "3", minQty: "100" }]);
  });
  it("doldur: TL listede kur gitmez; boş kâr gitmez", () => {
    expect(buildFillBody({ markupPct: "", fxRate: "35" }, "TRY")).toEqual({});
    expect(buildFillBody({ markupPct: "20", fxRate: "35,1" }, "USD")).toEqual({ markupPct: "20", fxRate: "35.1" });
  });
});

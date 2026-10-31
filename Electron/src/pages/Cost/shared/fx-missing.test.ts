// Kur gövdesi ve eksik → alan eşlemesi: boş kur sunucuya GİTMEZ (1 varsayılmaz); 400 COST_INPUT_MISSING
// kodları forma (kur/devir/atkı boyu/tarife) ya da ilgili ekrana bağlanır.
import { describe, expect, it } from "vitest";
import { foreignCurrencies, fxBody } from "./FxRateInputs";
import { missingFields, missingTarget } from "./missing-targets";
import type { CostInputSnap } from "./cost-types";

describe("fxBody", () => {
  it("boş/geçersiz kur gövdeye girmez, dolu kur Decimal metni olur", () => {
    expect(fxBody({ USD: "", EUR: "  " })).toEqual({});
    expect(fxBody({ USD: "34,25", EUR: "" })).toEqual({ USD: "34.25" });
  });
});

describe("foreignCurrencies", () => {
  it("TRY dışı para birimleri tekil ve sıralı", () => {
    const g = {
      warp: { yarn: { price: { currency: "USD" } } },
      weft: { yarns: [{ price: { currency: "EUR" } }, { price: { currency: "USD" } }, { price: null }] },
      finishing: { price: { currency: "TRY" } },
    } as unknown as CostInputSnap;
    expect(foreignCurrencies(g)).toEqual(["EUR", "USD"]);
    expect(foreignCurrencies(null)).toEqual([]);
    const withProc = { finishing: null, processes: [{ price: { currency: "GBP" } }, { price: null }] } as unknown as CostInputSnap;
    expect(foreignCurrencies(withProc)).toEqual(["GBP"]);
  });
});

describe("missing-targets", () => {
  it("COST_INPUT_MISSING kodları alana eşlenir", () => {
    expect([...missingFields(["FX_RATE_MISSING", "RPM_MISSING", "YARN_PRICE_MISSING"])].sort()).toEqual(["fx", "loomRpm"]);
    expect(missingTarget("YARN_PRICE_MISSING")).toEqual({ kind: "link", to: "/cost/yarn-prices", label: "İplik Maliyet Fiyatları" });
    expect(missingTarget("BILINMEYEN")).toBeNull();
  });
});

// Hesaplayıcı gövdesi: boş alan gitmez, ürün ve elle yapı birlikte gitmez, fiyatsız iplikte para birimi yok,
// boş kur yok (1 varsayılmaz); hiçbir değer istemcide hesaplanmaz — TR yazımı yalnız Decimal metnine çevrilir.
import { describe, expect, it } from "vitest";
import { buildCalculatorBody, emptyCalculator, emptyYarn } from "./calculator-body";

describe("buildCalculatorBody", () => {
  it("ürün kipi: ürün yoksa istek yok; ürünle yalnız dolu ezmeler ve kur", () => {
    const s = emptyCalculator();
    expect(buildCalculatorBody(s)).toBeNull();
    s.itemId = "i1";
    s.overrides.loomRpm = "650";
    s.overrides.efficiencyPct = "85,5";
    s.fx = { USD: "", EUR: "36,1" };
    expect(buildCalculatorBody(s)).toEqual({ itemId: "i1", overrides: { loomRpm: "650", efficiencyPct: "85.5" }, fxRates: { EUR: "36.1" } });
    s.finishingRateCode = "BOYA";
    expect(buildCalculatorBody(s)?.overrides).toMatchObject({ finishingRateCode: "BOYA" });
  });
  it("elle kip: tel ya da sıklık yoksa istek yok; itemId gönderilmez", () => {
    const s = { ...emptyCalculator(), mode: "adHoc" as const, itemId: "i1" };
    expect(buildCalculatorBody(s)).toBeNull();
    s.adHoc = {
      ...s.adHoc, endsCount: "5200", takeUpPct: "8",
      warpYarn: { ...emptyYarn(), name: "PES 75", denier: "75", pricePerKg: "2,4", currency: "USD" },
      picksPerCm: "32",
      weftYarns: [{ ...emptyYarn(), denier: "150", picksInRepeat: "1" }],
    };
    const b = buildCalculatorBody(s)!;
    expect(b.itemId).toBeUndefined();
    expect(b.adHoc).toEqual({
      warp: { endsCount: "5200", takeUpPct: "8", yarn: { name: "PES 75", denier: "75", pricePerKg: "2.4", currency: "USD" } },
      weft: { picksPerCm: "32", yarns: [{ denier: "150", picksInRepeat: "1" }] },
      finishingRateCode: null,
    });
  });
});

// D4-I2b: risk limiti kip ipucu — varsayılan (ayar yok / eski backend) bugünkü "her para birimi ayrı" davranışını söyler.
import { describe, it, expect } from "vitest";
import { riskLimitModeHintText } from "./RiskLimitModeHint";
import { SETTINGS_CATEGORIES } from "../GeneralSettings/settings-config";
import { FLAG_MODULE } from "../GeneralSettings/flag-modules";

describe("Risk limiti para birimi kipi", () => {
  it("ipucu iki kipte doğru metni verir; ayar yoksa varsayılan", () => {
    expect(riskLimitModeHintText("TRY_CONVERTED")).toMatch(/günün kuruyla TL'ye çevrilip toplanır/);
    expect(riskLimitModeHintText("PER_CURRENCY")).toMatch(/her para biriminde ayrı/);
    expect(riskLimitModeHintText(undefined)).toBe(riskLimitModeHintText("PER_CURRENCY"));
  });

  it("Fabrika Ayarları satırı: Kasa & Risk, varsayılan PER_CURRENCY, iki seçenek, ön muhasebeye bağlı", () => {
    const finance = SETTINGS_CATEGORIES.find((c) => c.id === "finance");
    const row = finance?.enumFlags?.find((r) => r.enumKey === "financeRiskLimitCurrencyMode");
    expect(row).toBeDefined();
    expect(row?.title).toBe("Risk limiti para birimi");
    expect(row?.group).toBe("Kasa & Risk");
    expect(row?.defaultValue).toBe("PER_CURRENCY");
    expect(row?.options.map((o) => o.value)).toEqual(["PER_CURRENCY", "TRY_CONVERTED"]);
    expect(row?.desc).toMatch(/TL'ye çevrilmiş toplam günün kuruyla hesaplanır/);
    expect(FLAG_MODULE.financeRiskLimitCurrencyMode).toBe("financeEnabled");
  });
});

// D4-I2b: risk limiti kip ipucu — varsayılan (ayar yok / eski backend) bugünkü "her para birimi ayrı" davranışını söyler.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { riskLimitEnforcementText, riskLimitModeHintText } from "./RiskLimitModeHint";
import { SETTINGS_CATEGORIES } from "../GeneralSettings/settings-config";
import { FLAG_MODULE } from "../GeneralSettings/flag-modules";

describe("Risk limiti para birimi kipi", () => {
  it("ipucu iki kipte doğru metni verir; ayar yoksa varsayılan", () => {
    expect(riskLimitModeHintText("TRY_CONVERTED")).toMatch(/o güne kadarki en son kurla TL'ye çevrilip toplanır/);
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
    expect(row?.desc).toMatch(/TL'ye çevrilmiş toplam o güne kadarki en son kurla hesaplanır/);
    expect(FLAG_MODULE.financeRiskLimitCurrencyMode).toBe("financeEnabled");
  });
});

describe("Risk limiti engel metni (D4-KUC3a — 'yalnız uyarıdır' metni D4-I2 sonrası bayattı)", () => {
  it("üç engel kapalı (varsayılan / eski backend) → yalnız uyarı, hiçbir işlem durmaz", () => {
    expect(riskLimitEnforcementText(undefined)).toMatch(/yalnız uyarı verilir; satış, iş kabulü ve sevk durmaz/);
    expect(riskLimitEnforcementText({ financeRiskLimitBlockEnabled: false, financeRiskLimitBlockIntake: false, financeRiskLimitBlockShipment: false }))
      .toBe(riskLimitEnforcementText(undefined));
  });

  it("açık engeller adıyla sayılır; sevk engelinde emanet istisnası söylenir", () => {
    const t = riskLimitEnforcementText({ financeRiskLimitBlockIntake: true, financeRiskLimitBlockShipment: true });
    expect(t).toMatch(/^Limit aşılınca durdurulur: yeni iş kabulü/);
    expect(t).toMatch(/sevk \(tamamı müşterinin kendi emaneti olan sevk hariç\)/);
    expect(t).not.toMatch(/satış faturası onayı/);
    expect(riskLimitEnforcementText({ financeRiskLimitBlockEnabled: true })).toMatch(/durdurulur: satış faturası onayı\./);
  });

  it("cari düzenleme diyaloğunda sabit 'UYARIDIR, satışı bloklamaz' metni yok; canlı ipucu kullanılır", () => {
    const src = readFileSync(resolve(__dirname, "CariEditDialog.tsx"), "utf8");
    expect(src).not.toMatch(/UYARIDIR|bloklamaz/);
    expect(src).toContain("<RiskLimitModeHint />");
  });
});

// =============================================================================
// Risk limiti iş kabulü / sevk ayar satırları (D4-I2, 2026-10-30)
// =============================================================================
// Backend: `finance.riskLimitBlock.intake` / `.shipment` (bool, varsayılan false = bugünkü davranış).
// Panel satırı backend okuyucusunun varsayılanının AYNASIDIR; başlık `panel-ayar-yolu.ts` ile aynı
// (409 mesajı kullanıcıyı bu satıra yönlendirir). Backend tarafı: `Teks-Erp/scripts/test_risk_limiti_kapilar.ts`.
// =============================================================================
import { describe, it, expect } from "vitest";
import { SETTINGS_CATEGORIES } from "./settings-config";
import { FLAG_MODULE } from "./flag-modules";

const finance = SETTINGS_CATEGORIES.find((c) => c.id === "finance");
const row = (key: string) => finance?.flags?.find((r) => r.key === key);

describe("Risk limiti iş kabulü / sevk ayar satırları", () => {
  it("iki satır da varsayılan KAPALI, Kasa & Risk grubunda, fatura satırının yanında", () => {
    for (const k of ["financeRiskLimitBlockIntake", "financeRiskLimitBlockShipment"]) {
      expect(row(k)).toBeDefined();
      expect(row(k)?.defaultOn).toBe(false);
      expect(row(k)?.group).toBe("Kasa & Risk");
    }
    expect(row("financeRiskLimitBlockEnabled")?.defaultOn).toBe(false);
  });

  it("başlıklar backend yol tarifiyle birebir", () => {
    expect(row("financeRiskLimitBlockIntake")?.title).toBe("Risk limiti aşımında yeni iş kabulünü engelle");
    expect(row("financeRiskLimitBlockShipment")?.title).toBe("Risk limiti aşımında sevki engelle");
  });

  it("sevk satırı emanet muafiyetini söyler; iki satır ön muhasebe modülüne bağlı", () => {
    expect(row("financeRiskLimitBlockShipment")?.desc).toMatch(/emanet/);
    for (const k of ["financeRiskLimitBlockIntake", "financeRiskLimitBlockShipment"] as const) {
      expect(FLAG_MODULE[k]).toBe("financeEnabled");
    }
  });
});

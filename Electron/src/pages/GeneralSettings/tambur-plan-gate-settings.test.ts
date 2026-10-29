// =============================================================================
// Tambur plan kapısı EN ayarlarının panel satırları (D4-E1, 2026-10-29)
// =============================================================================
// Backend: `tambur.planGate.widthToleranceCm` (0-100, varsayılan 10) ve
// `tambur.planGate.widthCheck` (ENFORCE | OFF, varsayılan ENFORCE). Panel satırı
// backend sınırlarının ve varsayılanının AYNASIDIR; ayrışırsa panel geçerli bir
// değeri yazamaz ya da yanlış "Varsayılan" rozeti basar. Sözleşmenin backend tarafı
// `Teks-Erp/scripts/test_feature_flag_contract.ts` + `test_tambur_plan_gate.ts` E.
// =============================================================================
import { describe, it, expect } from "vitest";
import { SETTINGS_CATEGORIES } from "./settings-config";
import { FLAG_MODULE } from "./flag-modules";

const production = SETTINGS_CATEGORIES.find((c) => c.id === "production");

describe("Tambur en kapısı ayar satırları", () => {
  it("üretim kategorisi var", () => {
    expect(production).toBeDefined();
  });

  it("en kontrolü enum satırı: ENFORCE varsayılan, iki seçenek, Tambur grubunda", () => {
    const row = production?.enumFlags?.find((r) => r.enumKey === "tamburPlanGateWidthCheck");
    expect(row).toBeDefined();
    expect(row?.defaultValue).toBe("ENFORCE");
    expect(row?.options.map((o) => o.value)).toEqual(["ENFORCE", "OFF"]);
    expect(row?.group).toBe("Tambur");
    // OFF yalnız en kolunu kapatır — kullanıcıya renk kapısının sürdüğü söylenir.
    expect(row?.options.find((o) => o.value === "OFF")?.hint).toMatch(/renk/i);
  });

  it("en eşiği sayı satırı: 0-100 cm, varsayılan 10", () => {
    const row = production?.numberFlags?.find((r) => r.key === "tamburPlanGateWidthToleranceCm");
    expect(row).toBeDefined();
    expect(row?.min).toBe(0);
    expect(row?.max).toBe(100);
    expect(row?.fallback).toBe(10);
    expect(row?.unit).toBe("cm");
    expect(row?.group).toBe("Tambur");
  });

  it("iki satır da üretim modülüne ait", () => {
    expect(FLAG_MODULE.tamburPlanGateWidthCheck).toBe("productionEnabled");
    expect(FLAG_MODULE.tamburPlanGateWidthToleranceCm).toBe("productionEnabled");
  });
});

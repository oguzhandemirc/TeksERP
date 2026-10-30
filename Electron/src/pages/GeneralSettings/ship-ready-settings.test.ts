// =============================================================================
// Sevke hazır işler ayar satırları (D4-J1, 2026-10-30)
// =============================================================================
// Backend: `shipping.ready.rule` (ALL_DONE | METER_THRESHOLD, varsayılan ALL_DONE) ve
// `shipping.ready.tolerancePct` (0-20, varsayılan 2). Panel satırı backend sınırlarının ve
// varsayılanının AYNASIDIR; ayrışırsa panel geçerli değeri yazamaz ya da yanlış "Varsayılan"
// rozeti basar. Backend tarafı: `Teks-Erp/scripts/test_feature_flag_contract.ts` + `test_sevke_hazir.ts`.
// =============================================================================
import { describe, it, expect } from "vitest";
import { SETTINGS_CATEGORIES } from "./settings-config";
import { FLAG_MODULE } from "./flag-modules";

const shipping = SETTINGS_CATEGORIES.find((c) => c.id === "shipping");

describe("Sevke hazır işler ayar satırları", () => {
  it("kural enum satırı: ALL_DONE varsayılan, iki seçenek, Sevke hazır işler grubunda", () => {
    const row = shipping?.enumFlags?.find((r) => r.enumKey === "shippingReadyRule");
    expect(row).toBeDefined();
    expect(row?.defaultValue).toBe("ALL_DONE");
    expect(row?.options.map((o) => o.value)).toEqual(["ALL_DONE", "METER_THRESHOLD"]);
    expect(row?.group).toBe("Sevke hazır işler");
  });

  it("tolerans sayı satırı: 0-20 %, varsayılan 2", () => {
    const row = shipping?.numberFlags?.find((r) => r.key === "shippingReadyTolerancePct");
    expect(row).toBeDefined();
    expect(row?.min).toBe(0);
    expect(row?.max).toBe(20);
    expect(row?.fallback).toBe(2);
    expect(row?.unit).toBe("%");
    expect(row?.group).toBe("Sevke hazır işler");
  });

  it("iki satır da çekirdek sevkiyata ait", () => {
    for (const k of ["shippingReadyRule", "shippingReadyTolerancePct"] as const) {
      expect(FLAG_MODULE[k]).toBe("cekirdek");
    }
  });
});

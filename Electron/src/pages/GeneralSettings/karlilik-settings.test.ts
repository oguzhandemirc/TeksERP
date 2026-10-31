// =============================================================================
// Kârlılık kaynak ayarları (D4-G2a, 2026-10-31)
// =============================================================================
// Backend: `maliyet.karlilik.disFasonKaynagi` (FATURA_ONCE | YALNIZ_FATURA, varsayılan FATURA_ONCE) ve
// `maliyet.karlilik.sarfFiyatKaynagi` (ALIS_FIYATI | SON_ALIS_FATURASI, varsayılan ALIS_FIYATI). Panel satırı
// backend Zod enum'unun ve varsayılanının AYNASIDIR; ayrışırsa panel geçerli değeri yazamaz (400).
// Backend tarafı: `Teks-Erp/scripts/test_karlilik_cekirdek.ts` §6.
// =============================================================================
import { describe, it, expect } from "vitest";
import { SETTINGS_CATEGORIES } from "./settings-config";
import { FLAG_MODULE } from "./flag-modules";

const finance = SETTINGS_CATEGORIES.find((c) => c.id === "finance");
const row = (k: string) => finance?.enumFlags?.find((r) => r.enumKey === k);

describe("Kârlılık kaynak ayar satırları", () => {
  it("dış fason: FATURA_ONCE varsayılan, iki değer, Kârlılık grubunda", () => {
    const r = row("costProfitSubcontractSource");
    expect(r?.defaultValue).toBe("FATURA_ONCE");
    expect(r?.options.map((o) => o.value)).toEqual(["FATURA_ONCE", "YALNIZ_FATURA"]);
    expect(r?.group).toBe("Kârlılık");
  });

  it("sarf fiyatı: ALIS_FIYATI varsayılan, iki değer, Kârlılık grubunda", () => {
    const r = row("costProfitConsumablePriceSource");
    expect(r?.defaultValue).toBe("ALIS_FIYATI");
    expect(r?.options.map((o) => o.value)).toEqual(["ALIS_FIYATI", "SON_ALIS_FATURASI"]);
    expect(r?.group).toBe("Kârlılık");
  });

  it("iki satır da ön muhasebe modülüne bağlı (gelir faturadan okunur)", () => {
    for (const k of ["costProfitSubcontractSource", "costProfitConsumablePriceSource"] as const) {
      expect(FLAG_MODULE[k]).toBe("financeEnabled");
    }
  });
});

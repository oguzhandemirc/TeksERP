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

// D4-G2b: makine süresi + genel gider anahtarı (backend `PROFIT_MACHINE_TIME_MODES` / `PROFIT_OVERHEAD_KEYS`;
// backend tarafı `Teks-Erp/scripts/test_karlilik_makine_genel_gider.ts` §6). Kategori sınıfı haritası panel satırı
// DEĞİL (S14 cevabı bekleniyor); yalnız `featureFlagService` tip aynası.
describe("Kârlılık makine süresi / genel gider ayar satırları (D4-G2b)", () => {
  it("makine süresi: OTURUM varsayılan, üç değer", () => {
    const r = row("costProfitMachineTime");
    expect(r?.defaultValue).toBe("OTURUM");
    expect(r?.options.map((o) => o.value)).toEqual(["OTURUM", "VARDIYA", "NORM"]);
    expect(r?.group).toBe("Kârlılık");
  });

  it("genel gider anahtarı: YOK varsayılan, dört değer", () => {
    const r = row("costProfitOverheadKey");
    expect(r?.defaultValue).toBe("YOK");
    expect(r?.options.map((o) => o.value)).toEqual(["YOK", "METRE", "GELIR", "MAKINE_SAATI"]);
    expect(r?.group).toBe("Kârlılık");
  });

  it("iki yeni satır ön muhasebe modülüne bağlı", () => {
    for (const k of ["costProfitMachineTime", "costProfitOverheadKey"] as const) {
      expect(FLAG_MODULE[k]).toBe("financeEnabled");
    }
  });
});

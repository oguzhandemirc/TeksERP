// H1b: Kurşun çıkış metresi stok kipi ayar satırı — varsayılan RECORD (backend DEFAULT_KURSUN_METER_STOCK_MODE),
// iki seçenek, H2 sapma ayarlarıyla aynı kategoride, Üretim modülüne bağlı.
import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES } from "@/pages/GeneralSettings/settings-config";
import { FLAG_MODULE } from "@/pages/GeneralSettings/flag-modules";

describe("kursunMeterStockMode ayar satırı", () => {
  const cat = SETTINGS_CATEGORIES.find((c) => (c.enumFlags ?? []).some((f) => f.enumKey === "kursunMeterStockMode"));
  const flag = cat?.enumFlags?.find((f) => f.enumKey === "kursunMeterStockMode");

  it("varsayılan RECORD, seçenekler RECORD/APPLY", () => {
    expect(flag?.defaultValue).toBe("RECORD");
    expect(flag?.options.map((o) => o.value)).toEqual(["RECORD", "APPLY"]);
    expect(flag?.title).toBe("Çıkış metresi stoğu");
  });

  it("H2 sapma tabanı ayarıyla aynı kategoride ve Üretim modülüne bağlı", () => {
    expect(cat?.enumFlags?.some((f) => f.enumKey === "kursunMeterVarianceBasis")).toBe(true);
    expect(FLAG_MODULE.kursunMeterStockMode).toBe("productionEnabled");
  });
});

// K14: gram fiyatı tabanı ayar satırı — varsayılan "işin yapıldığı gündeki fiyat" (backend DEFAULT_KURSUN_GRAM_PRICE_BASIS),
// iki seçenek, finans modülüne bağlı, hizmet fiyat tarihi ayarıyla aynı kartta.
import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES } from "@/pages/GeneralSettings/settings-config";
import { FLAG_MODULE } from "@/pages/GeneralSettings/flag-modules";

describe("financeKursunGramPriceBasis ayar satırı", () => {
  const cat = SETTINGS_CATEGORIES.find((c) => (c.enumFlags ?? []).some((f) => f.enumKey === "financeKursunGramPriceBasis"));
  const row = cat?.enumFlags?.find((f) => f.enumKey === "financeKursunGramPriceBasis");

  it("varsayılan SERVICE_DATE (önerilen), ikinci seçenek fatura günü", () => {
    expect(row?.defaultValue).toBe("SERVICE_DATE");
    expect(row?.options.map((o) => [o.value, o.label])).toEqual([
      ["SERVICE_DATE", "İşin yapıldığı gündeki fiyat (önerilen)"],
      ["INVOICE_DATE", "Faturanın kesildiği gündeki fiyat"],
    ]);
    expect(row?.title).toBe("Gram fiyatı");
  });

  it("finans modülüne bağlı, hizmet fiyat tarihi ayarıyla aynı kartta", () => {
    expect(FLAG_MODULE.financeKursunGramPriceBasis).toBe("financeEnabled");
    expect(cat?.enumFlags?.some((f) => f.enumKey === "financeServiceBillingPriceDate")).toBe(true);
  });
});

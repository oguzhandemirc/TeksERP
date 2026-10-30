// D4-F1: okutmada müşteri barkodu ayar satırı — varsayılan kapalı (backend readScanCustomerCodeLookupEnabled),
// Sevkiyat kategorisinde, çekirdek (modül anahtarı yok).
import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES } from "@/pages/GeneralSettings/settings-config";
import { FLAG_MODULE } from "@/pages/GeneralSettings/flag-modules";

describe("scanCustomerCodeLookupEnabled ayar satırı", () => {
  const cat = SETTINGS_CATEGORIES.find((c) => (c.flags ?? []).some((f) => f.key === "scanCustomerCodeLookupEnabled"));
  const flag = cat?.flags?.find((f) => f.key === "scanCustomerCodeLookupEnabled");

  it("varsayılan kapalı (bugünkü davranış)", () => {
    expect(flag?.defaultOn).toBe(false);
    expect(flag?.title).toBe("Okutmada müşteri barkodunu da tanı");
  });

  it("Sevkiyat kategorisinde ve çekirdek", () => {
    expect(cat?.id).toBe("shipping");
    expect(FLAG_MODULE.scanCustomerCodeLookupEnabled).toBe("cekirdek");
  });
});

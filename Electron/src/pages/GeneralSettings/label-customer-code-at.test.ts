// D4-F2 (2026-11-01): `label.customerCodeAt` (NONE | TAMBUR_OUTPUT, varsayılan NONE = bugünkü).
// Panel satırı backend varsayılanının ve değer kümesinin AYNASIDIR; backend tarafı
// `Teks-Erp/scripts/test_feature_flag_contract.ts` + `test_musteri_barkod_serisi.ts` §7.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { SETTINGS_CATEGORIES } from "./settings-config";
import { FLAG_MODULE } from "./flag-modules";

const production = SETTINGS_CATEGORIES.find((c) => c.id === "production");

describe("Müşteri barkodu doğum yeri ayar satırı", () => {
  it("enum satırı: NONE varsayılan, iki seçenek, Tambur grubunda, üretim modülünde", () => {
    const row = production?.enumFlags?.find((r) => r.enumKey === "labelCustomerCodeAt");
    expect(row).toBeDefined();
    expect(row?.defaultValue).toBe("NONE");
    expect(row?.options.map((o) => o.value)).toEqual(["NONE", "TAMBUR_OUTPUT"]);
    expect(row?.group).toBe("Tambur");
    expect(FLAG_MODULE.labelCustomerCodeAt).toBe("productionEnabled");
  });

  it("varsayılan backend DEFAULT_LABEL_CUSTOMER_CODE_AT ile aynı", () => {
    const src = readFileSync(resolve(__dirname, "../../../../Teks-Erp/src/services/system-setting.service.ts"), "utf8");
    const m = src.match(/DEFAULT_LABEL_CUSTOMER_CODE_AT: LabelCustomerCodeAt = "([A-Z_]+)"/);
    const row = production?.enumFlags?.find((r) => r.enumKey === "labelCustomerCodeAt");
    expect(m?.[1]).toBe(row?.defaultValue);
  });
});

// D4-D3: fason kabulünde hedef desen ayar satırı — varsayılan kapalı (backend readFasonReceiptApplyTargetVariant),
// "Fason" grubunda, fason modül anahtarına bağlı.
import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES } from "@/pages/GeneralSettings/settings-config";
import { FLAG_MODULE } from "@/pages/GeneralSettings/flag-modules";

describe("fasonReceiptApplyTargetVariant ayar satırı", () => {
  const cat = SETTINGS_CATEGORIES.find((c) => (c.flags ?? []).some((f) => f.key === "fasonReceiptApplyTargetVariant"));
  const flag = cat?.flags?.find((f) => f.key === "fasonReceiptApplyTargetVariant");

  it("varsayılan kapalı (bugünkü davranış: dönen top yalnız bayrağı taşır)", () => {
    expect(flag?.defaultOn).toBe(false);
    expect(flag?.title).toBe("Fason kabulünde terbiye iş emrinin hedef desenini dönen topa yaz");
  });

  it("Fason grubunda, fason modülüne bağlı, kardeş fason ayarıyla aynı kartta", () => {
    expect(flag?.group).toBe("Fason");
    expect(FLAG_MODULE.fasonReceiptApplyTargetVariant).toBe("planlanan:fason");
    expect(cat?.flags?.some((f) => f.key === "fasonShrinkWarnEnabled")).toBe(true);
  });
});

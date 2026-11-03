// K16: atanan kurşun makinesi ayar satırı — varsayılan SUGGEST (backend DEFAULT_KURSUN_MACHINE_ASSIGN_MODE),
// iki seçenek, kurşun metre ayarlarıyla aynı kategoride, Üretim modülüne bağlı.
import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES } from "@/pages/GeneralSettings/settings-config";
import { FLAG_MODULE } from "@/pages/GeneralSettings/flag-modules";

describe("kursunMachineAssignMode ayar satırı", () => {
  const cat = SETTINGS_CATEGORIES.find((c) => (c.enumFlags ?? []).some((f) => f.enumKey === "kursunMachineAssignMode"));
  const flag = cat?.enumFlags?.find((f) => f.enumKey === "kursunMachineAssignMode");

  it("varsayılan SUGGEST, seçenekler SUGGEST/ASSIGNED_ONLY_WARN", () => {
    expect(flag?.defaultValue).toBe("SUGGEST");
    expect(flag?.options.map((o) => o.value)).toEqual(["SUGGEST", "ASSIGNED_ONLY_WARN"]);
    expect(flag?.title).toBe("Atanan kurşun makinesi");
  });

  it("kurşun stok kipiyle aynı kategoride ve Üretim modülüne bağlı", () => {
    expect(cat?.enumFlags?.some((f) => f.enumKey === "kursunMeterStockMode")).toBe(true);
    expect(FLAG_MODULE.kursunMachineAssignMode).toBe("productionEnabled");
  });
});

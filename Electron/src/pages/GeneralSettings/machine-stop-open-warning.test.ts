// D4-A2b: açık duruş dokunuş uyarısı ayar satırı — varsayılan kapalı (backend readMachineStopOpenWarningEnabled),
// "Üretim — Saha" kartında, Makine duruşu grubunda, üretim modülüne bağlı.
import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES } from "@/pages/GeneralSettings/settings-config";
import { FLAG_MODULE } from "@/pages/GeneralSettings/flag-modules";

describe("machineStopOpenWarningEnabled ayar satırı", () => {
  const cat = SETTINGS_CATEGORIES.find((c) => (c.flags ?? []).some((f) => f.key === "machineStopOpenWarningEnabled"));
  const flag = cat?.flags?.find((f) => f.key === "machineStopOpenWarningEnabled");

  it("varsayılan kapalı (sahadaki davranış: uyarı yok)", () => {
    expect(flag?.defaultOn).toBe(false);
    expect(flag?.title).toBe("Makine duruştayken tablette gramaj/metre girişinde uyarı göster");
  });

  it("Üretim — Saha kartında, Makine duruşu grubunda, üretim modülüne bağlı", () => {
    expect(cat?.id).toBe("production");
    expect(cat?.label).toBe("Üretim — Saha");
    expect(flag?.group).toBe("Makine duruşu");
    expect(FLAG_MODULE.machineStopOpenWarningEnabled).toBe("productionEnabled");
  });
});

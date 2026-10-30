// D4-B1a: Tambur ölçüm kaynağı ayar satırları — varsayılanlar backend okuyucularıyla birebir
// (simüle AÇIK, zorunlu KAPALI), Tambur grubunda; zorunlu satırı tablet önkoşulunu söyler.
import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES } from "@/pages/GeneralSettings/settings-config";
import { FLAG_MODULE } from "@/pages/GeneralSettings/flag-modules";

const flagOf = (key: string) => SETTINGS_CATEGORIES.flatMap((c) => c.flags ?? []).find((f) => f.key === key);

describe("Tambur ölçüm kaynağı ayarları", () => {
  it("simüle metre: varsayılan AÇIK (bugünkü davranış), Tambur grubu", () => {
    const f = flagOf("tamburSimulatedMeterEnabled");
    expect(f?.defaultOn).toBe(true);
    expect(f?.group).toBe("Tambur");
    expect(FLAG_MODULE.tamburSimulatedMeterEnabled).toBe("productionEnabled");
  });

  it("ölçüm kaynağı zorunlu: varsayılan KAPALI ve satırda tablet önkoşulu yazılı", () => {
    const f = flagOf("tamburMeasureSourceRequired");
    expect(f?.defaultOn).toBe(false);
    expect(f?.group).toBe("Tambur");
    expect(f?.summary).toMatch(/Önce tüm tabletler yeni sürümde olmalı/);
    expect(FLAG_MODULE.tamburMeasureSourceRequired).toBe("productionEnabled");
  });
});

import { describe, expect, it } from "vitest";
import { legacySettingsTarget } from "./legacy-settings";

describe("eski Genel Ayarlar adresi yönlendirmesi", () => {
  it("sekmesiz adres Baskı & Cihazlar'a gider", () => {
    expect(legacySettingsTarget(null)).toBe("/system/printing");
  });
  it("her sekme kendi ekranına gider", () => {
    expect(legacySettingsTarget("label")).toBe("/system/printing?tab=label");
    expect(legacySettingsTarget("printer")).toBe("/system/workstation?tab=printer");
    expect(legacySettingsTarget("session")).toBe("/system/company?tab=session");
    expect(legacySettingsTarget("shipping")).toBe("/system/feature-flags?tab=shipping");
  });
  it("eski takma ad çözülür (?tab=system → yazıcı)", () => {
    expect(legacySettingsTarget("system")).toBe("/system/workstation?tab=printer");
  });
  it("tanınmayan ya da satıcı sekmesi hub'a düşer", () => {
    expect(legacySettingsTarget("yok-boyle")).toBe("/system");
    expect(legacySettingsTarget("modules")).toBe("/system");
  });
});

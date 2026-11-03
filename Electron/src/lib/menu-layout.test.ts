import { describe, expect, it } from "vitest";
import { EMPTY_MENU_LAYOUT, isHubTileHidden, isInAdvancedGroup, isMenuHidden, menuKeyOf, toMenuLayoutState } from "./menu-layout";

// K19 menü süzgeci (saf). Varsayılan/eski sunucu/hata → boş süzgeç = bugünkü menü; Gelişmiş yalnız ayar açıkken.
describe("menu-layout süzgeci", () => {
  it("route yolu → katalog anahtarı", () => {
    expect(menuKeyOf("/system/perf?tab=x#y")).toBe("system/perf");
    expect(menuKeyOf("/documents/")).toBe("documents");
    expect(menuKeyOf("KK1")).toBe("KK1");
  });
  it("⭐ görünüm yok (eski sunucu / hata) → hiçbir şey gizli değil, Gelişmiş boş", () => {
    expect(toMenuLayoutState(undefined)).toBe(EMPTY_MENU_LAYOUT);
    expect(toMenuLayoutState(null)).toBe(EMPTY_MENU_LAYOUT);
    expect(isHubTileHidden(EMPTY_MENU_LAYOUT, "/system/perf")).toBe(false);
  });
  it("Gelişmiş kapalıyken teknik ekran hub'da kalır; açıkken hub'dan çıkar", () => {
    const off = toMenuLayoutState({ hiddenScreens: [], advancedGroup: false, advancedScreens: ["system/perf"] });
    expect(isInAdvancedGroup(off, "/system/perf")).toBe(false);
    expect(isHubTileHidden(off, "/system/perf")).toBe(false);
    const on = toMenuLayoutState({ hiddenScreens: [], advancedGroup: true, advancedScreens: ["system/perf"] });
    expect(isInAdvancedGroup(on, "/system/perf")).toBe(true);
    expect(isHubTileHidden(on, "/system/perf")).toBe(true);
    expect(isHubTileHidden(on, "/system/logs")).toBe(false);
  });
  it("gizli ekran Gelişmiş grubunda da yok; gizli hub karosu çizilmez", () => {
    const s = toMenuLayoutState({ hiddenScreens: ["system/perf", "operations/kartela"], advancedGroup: true, advancedScreens: ["system/perf"] });
    expect(isMenuHidden(s, "/operations/kartela")).toBe(true);
    expect(isInAdvancedGroup(s, "/system/perf")).toBe(false);
    expect(isHubTileHidden(s, "/operations/kartela")).toBe(true);
    expect(isHubTileHidden(s, "/operations/work-orders")).toBe(false);
  });
  it("⭐ rapor kategorisi gizliyse ALT raporları da gizli (palet + Merkez); başka kategori ve kategori-dışı yol etkilenmez", () => {
    const s = toMenuLayoutState({ hiddenScreens: ["reports/subcontract"], advancedGroup: false, advancedScreens: [] });
    expect(isMenuHidden(s, "/reports/subcontract")).toBe(true);
    expect(isMenuHidden(s, "/reports/subcontract/scorecard")).toBe(true);
    expect(isMenuHidden(s, "/reports/subcontract/fasoncular?x=1")).toBe(true);
    expect(isMenuHidden(s, "/reports/sales/termin")).toBe(false);
    expect(isMenuHidden(s, "/reports/subcontractx/a")).toBe(false);
    expect(isMenuHidden(s, "/operations/subcontract/x")).toBe(false);
  });
});

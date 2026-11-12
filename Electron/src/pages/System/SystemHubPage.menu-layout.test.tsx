// K19 MENÜ DÜZENİ — hub karoları. Gizlenen ekran karosu çizilmez; Gelişmiş grubu AÇIKKEN teknik karo hub'dan çıkar
// (kenar menüde toplanır), KAPALIYKEN bugünkü yerinde. Dokuz hub aynı süzgeçten geçer (kaynak metin ölçülür).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import { EMPTY_MENU_LAYOUT, toMenuLayoutState, type MenuLayoutState } from "@/lib/menu-layout";

let menu: MenuLayoutState = EMPTY_MENU_LAYOUT;
vi.mock("@/hooks/useMenuLayout", () => ({ useMenuLayout: () => menu }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ isAdmin: true, hasPermission: () => true, hasAnyPermission: () => true }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }),
}));
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: { density: "comfortable" }, setPreference: vi.fn() }),
}));

import { SystemHubPage } from "./SystemHubPage";

const HUBS = [
  "Access/AccessHubPage.tsx", "Cost/CostHubPage.tsx", "Definitions/DefinitionsHubPage.tsx", "Documents/DocumentsHubPage.tsx",
  "Finance/FinanceHubPage.tsx", "Operations/useSectionTiles.ts" /* T5: Operasyon bölüm sayfalarının süzgeci */, "Quality/QualityHubPage.tsx",
  "System/SystemHubPage.tsx",
];

beforeEach(() => {
  menu = EMPTY_MENU_LAYOUT;
  useAuthStore.setState({ isSystemAccount: false, systemAccountExists: true });
});

describe("SystemHubPage — K19 menü düzeni", () => {
  it("varsayılan: teknik karolar bugünkü yerinde", () => {
    renderWithProviders(<SystemHubPage />);
    expect(screen.getByText("Sunucu Durumu")).toBeTruthy();
    expect(screen.getByText("Menü Düzeni")).toBeTruthy();
  });
  it("⭐ Gelişmiş açık → teknik karo hub'dan çıkar; kapalıyken aynı liste yerinde kalır", () => {
    menu = toMenuLayoutState({ hiddenScreens: [], advancedGroup: false, advancedScreens: ["system/server-status"] });
    const { unmount } = renderWithProviders(<SystemHubPage />);
    expect(screen.getByText("Sunucu Durumu")).toBeTruthy();
    unmount();
    menu = toMenuLayoutState({ hiddenScreens: [], advancedGroup: true, advancedScreens: ["system/server-status"] });
    renderWithProviders(<SystemHubPage />);
    expect(screen.queryByText("Sunucu Durumu")).toBeNull();
    expect(screen.getByText("Özellik Anahtarları")).toBeTruthy();
  });
  it("gizlenen karo çizilmez", () => {
    menu = toMenuLayoutState({ hiddenScreens: ["system/server-status"], advancedGroup: false, advancedScreens: [] });
    renderWithProviders(<SystemHubPage />);
    expect(screen.queryByText("Sunucu Durumu")).toBeNull();
  });
  it("dokuz hub da aynı süzgeçten geçer (isHubTileHidden)", () => {
    for (const f of HUBS) {
      const src = readFileSync(resolve(__dirname, "..", f), "utf8");
      expect(src, f).toMatch(/isHubTileHidden\(menu, /);
    }
    // Dokuzuncu: Rapor Merkezi karo çizmez ("Eski raporlar" bölümü 2026-11-12 kalktı); süzgeç `centerGroups`ta, aynı menü durumuyla.
    const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");
    expect(read("Reports/_v2/ReportCenterPage.tsx")).toMatch(/centerGroups\(access, undefined, menu\)/);
    expect(read("Reports/_v2/center-model.ts")).toMatch(/!isMenuHidden\(menu, /);
  });
});

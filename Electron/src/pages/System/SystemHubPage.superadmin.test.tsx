// =============================================================================
// BEKÇİ — SİSTEM HUB'INDA SATICI KAROSU (ÜÇÜNCÜ KAPI: KİMLİK)
// =============================================================================
// "Sistem Profili" karosu fabrika yöneticisine ÇİZİLMEZ: satıcı ekranıdır ve
// keşfe davet etmemesi gerekir. Ama kapı İZNİN YERİNE GEÇMEZ — karo hâlâ
// `admin:settings` taşır ve route ile birebir kalır (`tile-route-permission`).
//
// ⚠️ SUPAP DA ÖLÇÜLÜYOR: sistem hesabı hiç doğmamış bir kurulumda karo GÖRÜNÜR.
// Aksi halde süperadminsiz kurulum modüllerini yapılandıracak ekranı hiç bulamaz.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import { systemTiles } from "./tile-config";

vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ isAdmin: true, hasPermission: () => true }),
}));
// Sayfa kabuğunun (PageHeader → favoriler/yoğunluk) provider bağımlılıkları —
// bu bekçinin konusu değil.
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
    reorderFavorites: vi.fn(),
  }),
}));
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: { density: "comfortable" }, setPreference: vi.fn() }),
}));

import { SystemHubPage } from "./SystemHubPage";

const KARO = /Sistem Profili/;

beforeEach(() => {
  useAuthStore.setState({ isSystemAccount: false, systemAccountExists: true });
});

describe("Sistem Profili karosu", () => {
  it("karo kendi iznini TAŞIR (kimlik onun yerine geçmez)", () => {
    const tile = systemTiles.find((t) => t.key === "module-profile");
    expect(tile?.permission).toBe("admin:settings");
    expect(tile?.superadminOnly).toBe(true);
    expect(tile?.to).toBe("/system/module-profile");
  });

  it("⭐ fabrika yöneticisinde ÇİZİLMEZ (tam yetkili admin olsa bile)", () => {
    renderWithProviders(<SystemHubPage />);
    expect(screen.queryByText(KARO)).toBeNull();
    // Regresyon: diğer yapılandırma karoları yerinde.
    expect(screen.getByText("Genel Ayarlar")).toBeTruthy();
  });

  it("satıcı hesabında çizilir", () => {
    useAuthStore.setState({ isSystemAccount: true, systemAccountExists: true });
    renderWithProviders(<SystemHubPage />);
    expect(screen.getByText(KARO)).toBeTruthy();
  });

  it("⭐ SUPAP: sistem hesabı hiç doğmamışsa çizilir", () => {
    useAuthStore.setState({ isSystemAccount: false, systemAccountExists: false });
    renderWithProviders(<SystemHubPage />);
    expect(screen.getByText(KARO)).toBeTruthy();
  });
});

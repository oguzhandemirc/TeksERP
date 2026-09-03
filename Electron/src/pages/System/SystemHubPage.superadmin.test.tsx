// =============================================================================
// BEKÇİ — SİSTEM HUB'INDA SATICI KAROSU (ÜÇÜNCÜ KAPI: KİMLİK)
// =============================================================================
// "Sistem Profili" karosu fabrika yöneticisine ÇİZİLMEZ: satıcı ekranıdır ve
// keşfe davet etmemesi gerekir. Ama kapı İZNİN YERİNE GEÇMEZ — karo hâlâ
// `admin:settings` taşır ve route ile birebir kalır (`tile-route-permission`).
//
// ⚠️ SUPAP BU KARODA YOK (kullanıcı kararı 2026-09-03): sistem hesabı hiç
// doğmamış olsa BİLE karo çizilmez — satıcı ekranı fabrikaya görünmez.
// Kilitlenme riski YOK çünkü YAZMA yolu ayrı ve supaplı: o kurulumda
// Genel Ayarlar → Modüller sekmesi fabrika yöneticisine açık kalır
// (`FeatureFlagSection`, bandıyla birlikte). Görünürlük ile yazma AYRI
// sorulardır — `lib/superadmin-gate.ts` ikisini iki ayrı yüklemle söyler.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import { systemTiles } from "./tile-config";
import { isSuperadminGateOpen, isSystemAccountIdentity } from "@/lib/superadmin-gate";

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

  it("⭐ SUPAP KAROYU AÇMAZ: sistem hesabı hiç doğmamışsa da çizilmez", () => {
    // Bu testin ESKİ hâli tam tersini ölçüyordu. Karar değişti: satıcı ekranı
    // her durumda gizli; kilitlenmeyi önleyen şey Genel Ayarlar'daki yazma
    // yolunun açık kalması (aşağıdaki ikinci beklenti onun ikizi).
    useAuthStore.setState({ isSystemAccount: false, systemAccountExists: false });
    renderWithProviders(<SystemHubPage />);
    expect(screen.queryByText(KARO)).toBeNull();
  });

  it("⭐ KİLİTLENME YOK: supap açıkken modül anahtarları Genel Ayarlar'dan YAZILABİLİR", () => {
    // Görünürlük kapısı supapsız, YAZMA kapısı supaplı — ikisi birlikte her
    // kurulumda en az bir yazıcı bırakır (kilitlenme ihtimali sıfır).
    expect(isSuperadminGateOpen({ isSystemAccount: false, systemAccountExists: false })).toBe(true);
    expect(isSystemAccountIdentity({ isSystemAccount: false, systemAccountExists: false })).toBe(false);
    // Hesap doğduğu an yazma satıcıya geçer, sekme salt-okunur olur.
    expect(isSuperadminGateOpen({ isSystemAccount: false, systemAccountExists: true })).toBe(false);
  });
});

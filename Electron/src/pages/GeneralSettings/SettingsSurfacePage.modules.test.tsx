// =============================================================================
// BEKÇİ — KAPALI MODÜLÜN BAYRAĞI EKRANDA ÇİZİLMEZ (bileşen turu)
// =============================================================================
// NEDEN AYRI BİR BİLEŞEN TESTİ: kural saf katmanda zaten kilitli
// (`flag-modules.test.ts`), ama saf yüklem ÇAĞIRANIN yanlış listeyi geçmesini
// engelleyemez — `SettingsSurfacePage` süzülmüş dizileri değil de `cat.flags`ı
// geçseydi tüm saf testler YEŞİL kalır, ekran eskisi gibi çizerdi. Aynı gerekçe
// `SettingsSurfacePage.search.test.tsx` başlığında da yazılı.
//
// ÖLÇÜLENLER:
//   §1 ⭐ Modülü kapalı kategori sekmesi HİÇ çizilmez (iplik · ticaret · üretim)
//   §2 ⭐ KARMA kategoride yalnız modüle ait SATIRLAR düşer; kategori durur
//   §3 ⭐ Modüller açıkken hiçbir şey kaybolmaz (regresyon zemini)
//
// NEGATİF SONDA (koşuldu, dosya birebir geri alındı): `SettingsSurfacePage`te
// `rows.flags` → `cat.flags ?? []`e ve kategori süzgeci (`moduleVisible`) düz
// `permitted`e döndürüldü → §1 ve §2 kırmızı.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { FeatureFlags } from "@/services/featureFlagService";
import { FeatureFlagsPage } from "./FeatureFlagsPage";

let permissions: string[] = ["admin:settings"];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    user: null,
    permissions,
    isAdmin: true,
    hasPermission: (p: string) => permissions.includes(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => permissions.includes(p)),
    hasAllPermissions: (ps: string[]) => ps.every((p) => permissions.includes(p)),
  }),
}));

// Modül fotoğrafı test başına yazılır — `resolveSettingsModuleState` eksik alanı
// backend varsayılanına düşürür (üretim AÇIK, gerisi kapalı).
let flags: Partial<FeatureFlags> = {};
vi.mock("@/hooks/usePricingEnabled", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/usePricingEnabled")>(
    "@/hooks/usePricingEnabled",
  );
  return {
    ...actual,
    FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
    useFeatureFlags: () => ({ data: { success: true, data: flags }, isLoading: false }),
  };
});
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
// ⚠️ `SETTING_KEYS` GERÇEK DEĞERLERİYLE KALIR (`importActual`): ham ayar
// satırlarının anahtarı oradan geliyor ve boş bir mock, `settingFields`
// satırlarını `undefined` anahtarla doğurup süzgeci ölçülemez hâle getirirdi.
vi.mock("@/services/systemSettingService", async () => {
  const actual =
    await vi.importActual<typeof import("@/services/systemSettingService")>(
      "@/services/systemSettingService",
    );
  return {
    ...actual,
    systemSettingService: {
      list: vi.fn().mockResolvedValue({ success: true, data: [] }),
      upsert: vi.fn(),
    },
    settingsPasswordAdminService: { status: vi.fn(), set: vi.fn(), revoke: vi.fn() },
  };
});

const tab = (name: RegExp) => screen.queryByRole("tab", { name });

describe("Özellik Anahtarları — kapalı modül ekranda çizilmez", () => {
  beforeEach(() => {
    permissions = ["admin:settings"];
    // Fabrika yöneticisi (satıcı DEĞİL) — satıcı görünümü hiçbir şeyi gizlemez.
    useAuthStore.setState({ isSystemAccount: false, systemAccountExists: true });
  });

  it("§1 ⭐ modülü kapalı kategorinin SEKMESİ hiç çizilmez", () => {
    flags = { productionEnabled: false, ticaretEnabled: false, iplikEnabled: false };
    renderWithProviders(<FeatureFlagsPage />);
    expect(tab(/^İplik$/i)).not.toBeInTheDocument();
    expect(tab(/Mal Kabul & Alış/i)).not.toBeInTheDocument();
    expect(tab(/^İş Emirleri$/i)).not.toBeInTheDocument();
    // Çekirdek sekmeler yerinde — gizleme kapsamı kaymadı.
    expect(tab(/^Müşteriler$/i)).toBeInTheDocument();
  });

  it("§2 ⭐ karma kategori DURUR, yalnız modüle ait satırları düşer", () => {
    flags = { productionEnabled: false };
    renderWithProviders(<FeatureFlagsPage />);
    // "Üretim — Saha" sekmesi Fason satırları sayesinde ayakta.
    const uretim = tab(/Üretim — Saha/i);
    expect(uretim).toBeInTheDocument();
    // ⚠️ Radix sekmesi `mouseDown` + `click` ister; salt `click()` içeriği
    // değiştirmez ve iki kontrol de BOŞ ekranda vakumen yeşile düşerdi.
    fireEvent.mouseDown(uretim!);
    fireEvent.click(uretim!);
    // Üretime ait KK1 satırı yok…
    expect(screen.queryByText(/KK1 ham kumaş girişinde en/i)).not.toBeInTheDocument();
    // …ama anahtarı henüz doğmamış fason satırı duruyor (`planlanan:fason`).
    expect(screen.getByText(/Fason kabulünde çekme/i)).toBeInTheDocument();
  });

  it("§3 modüller AÇIKKEN hiçbir sekme kaybolmaz (regresyon zemini)", () => {
    flags = {
      productionEnabled: true,
      ticaretEnabled: true,
      iplikEnabled: true,
      financeEnabled: true,
    };
    renderWithProviders(<FeatureFlagsPage />);
    expect(tab(/^İplik$/i)).toBeInTheDocument();
    expect(tab(/Mal Kabul & Alış/i)).toBeInTheDocument();
    expect(tab(/^İş Emirleri$/i)).toBeInTheDocument();
    expect(tab(/^Muhasebe$/i)).toBeInTheDocument();
  });
});

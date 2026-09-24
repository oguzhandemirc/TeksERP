// =============================================================================
// BEKÇİ — SATICI YÜZEYLERİNİN GÖRÜNÜRLÜĞÜ (ÜÇÜNCÜ KAPI: KİMLİK + SUPAP)
// =============================================================================
// 2026-09-04 kullanıcı kararı: "modül flaglarını ayrı bir yere taşıyalım …
// modüller menüsü de sadece süperadmine gözüksün · demo menüsü de sadece
// süperadmine gözüksün". Modül anahtarları Genel Ayarlar'dan ÇIKTI ve tek evi
// Sistem → **Modüller** karosu oldu; kurulum beyanı (demo) da oraya taşındı.
//
// ⚠️⚠️ BU TAŞIMA GÖRÜNÜRLÜK YÜKLEMİNİ DE DEĞİŞTİRDİ. 2026-09-03'te karo
// SUPAPSIZ gizleniyordu ve bu MEŞRUYDU: modül anahtarlarının İKİNCİ bir yazma
// yolu vardı (Genel Ayarlar → Modüller sekmesi), yani satıcı ekranını tamamen
// gizlemek kimseyi kilitlemiyordu. O sekme kaldırılınca supapsız gizleme bir
// KİLİTLENME hâline geldi: süperadmin hesabı doğmamış bir kurulumda karo
// çizilmez + route 403 verir + geriye yazacak yüzey KALMAZ → modüller bir daha
// AÇILAMAZ. Bu yüzden yüklem artık tek ve SUPAPLI (`isSuperadminGateOpen`).
//
// Ölçülen üç durum (üçü de aşağıda ve üçü de gerekli):
//   ① satıcı hesabı              → karo VAR
//   ② fabrika yöneticisi + hesap VAR → karo YOK   (kullanıcının istediği kural)
//   ③ fabrika yöneticisi + hesap YOK → karo VAR   (EMNİYET SUPABI)
//
// NEGATİF SONDA (2026-09-04, geri alındı): `SystemHubPage`in yüklemi
// `isSystemAccountIdentity` benzeri supapsız bir kurala çevrildi (yani
// `isSystemAccount` tek başına) → §③ kırmızı (1 kontrol) ve raporda "supap
// kapandı" olarak okunur.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import { systemTiles } from "./tile-config";
import { isSuperadminGateOpen } from "@/lib/superadmin-gate";

vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    isAdmin: true,
    hasPermission: () => true,
    hasAnyPermission: () => true,
  }),
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

const MODUL_KAROSU = "Modüller";

beforeEach(() => {
  useAuthStore.setState({ isSystemAccount: false, systemAccountExists: true });
});

describe("Modüller karosu (satıcı yüzeyi)", () => {
  it("karo kendi iznini TAŞIR (kimlik onun yerine geçmez)", () => {
    const tile = systemTiles.find((t) => t.key === "module-profile");
    expect(tile?.title).toBe(MODUL_KAROSU);
    expect(tile?.permission).toBe("admin:settings");
    expect(tile?.superadminOnly).toBe(true);
    expect(tile?.to).toBe("/system/module-profile");
  });

  it("⭐ ② fabrika yöneticisinde ÇİZİLMEZ (tam yetkili admin olsa bile)", () => {
    renderWithProviders(<SystemHubPage />);
    expect(screen.queryByText(MODUL_KAROSU)).toBeNull();
    // Regresyon: fabrikanın KENDİ ekranları yerinde.
    expect(screen.getByText("Baskı & Cihazlar")).toBeTruthy();
    expect(screen.getByText("Özellik Anahtarları")).toBeTruthy();
    expect(screen.getByText("Güncelleme")).toBeTruthy();
  });

  it("① satıcı hesabında çizilir", () => {
    useAuthStore.setState({ isSystemAccount: true, systemAccountExists: true });
    renderWithProviders(<SystemHubPage />);
    expect(screen.getByText(MODUL_KAROSU)).toBeTruthy();
  });

  it("⭐ ③ EMNİYET SUPABI: sistem hesabı HİÇ doğmamışsa fabrika yöneticisine de çizilir", () => {
    // ⚠️ Bu beklenti 2026-09-03'te TAM TERSİYDİ ve o gün doğruydu — modül
    // anahtarlarının Genel Ayarlar'da ikinci bir yazma yolu vardı. O yol
    // 2026-09-04'te kaldırıldığı için burada gizlemek, kurulumu modülsüz
    // bırakır. Kuralı geri çevirmeden önce ikinci bir yazma yüzeyi kur.
    useAuthStore.setState({ isSystemAccount: false, systemAccountExists: false });
    renderWithProviders(<SystemHubPage />);
    expect(screen.getByText(MODUL_KAROSU)).toBeTruthy();
  });

  it("⭐ KİLİTLENME YOK: yüklemin doğruluk tablosu karonun çizimiyle AYNI", () => {
    expect(isSuperadminGateOpen({ isSystemAccount: false, systemAccountExists: false })).toBe(true);
    expect(isSuperadminGateOpen({ isSystemAccount: true, systemAccountExists: true })).toBe(true);
    // Hesap doğduğu an satıcı yüzeyi fabrikaya kapanır.
    expect(isSuperadminGateOpen({ isSystemAccount: false, systemAccountExists: true })).toBe(false);
  });
});

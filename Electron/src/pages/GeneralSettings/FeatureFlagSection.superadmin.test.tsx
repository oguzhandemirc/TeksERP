// =============================================================================
// BEKÇİ — "MODÜLLER" KATEGORİSİ SATICI (SÜPERADMİN) HESABINA KİLİTLİ
// =============================================================================
// NEDEN VAR: modül anahtarlarını backend'de artık yalnız sistem hesabı yazar
// (`flagWriteGuard` üçüncü dalı → 403 MODULE_FLAG_SUPERADMIN_ONLY). Panel bunu
// AYNALAMAZSA fabrika yöneticisi toggle'ı çevirir, "Kaydet"e basar ve 403 yer;
// üstelik sebep hiçbir yerde yazmaz. Kategori GİZLENMİYOR (bilinçli): fabrika
// hangi modüllerin açık olduğunu görebilmeli.
//
// ÖLÇÜLENLER:
//   §1 Fabrika yöneticisi (admin:settings, sistem hesabı DEĞİL, sistem hesabı
//      VAR) → toggle yok, salt-okunur satır + bant var, Kaydet çubuğu yok.
//   §2 Satıcı hesabı (isSystemAccount) → toggle var, bant YOK.
//   §3 SUPAP: sistem hesabı hiç doğmamışsa (systemAccountExists=false) fabrika
//      yöneticisi BUGÜNKÜ gibi yazabilir — backend supabının aynası. Bu
//      olmadan süperadminsiz her kurulum modüllerini bir daha açamaz.
//   §4 REGRESYON: `superadminOnly` taşımayan kategori kimlikten ETKİLENMEZ
//      (izin tek başına yeter) — kilidin tüm ayarlara sızmadığının kanıtı.
//   §5 İzin YOKSA kimlik kurtarmaz (kapı ÇARPIM, "veya" değil).
//
// NEGATİF SONDA (2026-09-03, dosya yedekten geri yüklendi):
//   ① `canEdit` sondaki `&& (!superadminOnly || superadminGateOpen)` düşürüldü
//      → §1 kırmızı (2), §3/§2/§4 yeşil kaldı.
//   ② supap `|| !systemAccountExists` düşürüldü → §3 kırmızı (1).
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { FlagDef } from "./settings-config";

const flags = vi.fn();
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFeatureFlags: () => flags(),
}));

const perm = vi.fn();
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: (p: string) => perm(p) }),
}));

import { FeatureFlagSection } from "./FeatureFlagSection";

const FLAG: FlagDef = {
  key: "ticaretEnabled",
  title: "Ticaret modülünü aç",
  summary: "Alış siparişi, mal kabul…",
  defaultOn: false,
  audience: ["Yönetim"],
  desc: "Kapalıyken uçlar 403 verir.",
};

// ⚠️ BANDA ÖZGÜ METİN (2026-09-03): satırın kendi sebep cümlesi de artık
// "yalnız sistem yöneticisi değiştirir" diyor (`ReadOnlyRow.reason`), yani eski
// desen İKİ elemana birden uyup `getByText`i düşürüyordu. Bandı ayıran parça
// yönlendirme cümlesidir.
const BANT = /Modül açma\/kapatma talebiniz için yazılım firmanıza başvurun/i;
const SATIR_SEBEBI = /^Bu anahtarı yalnız sistem yöneticisi değiştirir\.$/;

function setIdentity(isSystemAccount: boolean, systemAccountExists: boolean) {
  useAuthStore.setState({ isSystemAccount, systemAccountExists });
}

beforeEach(() => {
  perm.mockImplementation(() => true);
  flags.mockReturnValue({ isLoading: false, data: { data: { ticaretEnabled: false } } });
  setIdentity(false, true);
});

describe("Modüller kategorisi — süperadmin kilidi", () => {
  it("§1 fabrika yöneticisi: salt-okunur + bant (sistem hesabı VAR)", () => {
    setIdentity(false, true);
    renderWithProviders(<FeatureFlagSection flags={[FLAG]} superadminOnly />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText(BANT)).toBeTruthy();
    // ⭐ SATIR DA AYNI TEŞHİSİ BASAR: eskiden sabit "admin:settings yetkisi
    // gerekir" yazıyordu ve kullanıcı olmayan bir yetkiyi aramaya giderdi.
    expect(screen.getByText(SATIR_SEBEBI)).toBeTruthy();
    expect(screen.queryByText(/admin:settings/)).toBeNull();
    expect(screen.queryByRole("button", { name: /kaydet/i })).toBeNull();
  });

  it("§2 satıcı hesabı: yazabilir, bant YOK", () => {
    setIdentity(true, true);
    renderWithProviders(<FeatureFlagSection flags={[FLAG]} superadminOnly />);
    expect(screen.getByRole("switch")).toBeTruthy();
    expect(screen.queryByText(BANT)).toBeNull();
  });

  it("§3 SUPAP: sistem hesabı hiç doğmamışsa fabrika yöneticisi yazabilir", () => {
    setIdentity(false, false);
    renderWithProviders(<FeatureFlagSection flags={[FLAG]} superadminOnly />);
    expect(screen.getByRole("switch")).toBeTruthy();
    expect(screen.queryByText(BANT)).toBeNull();
  });

  it("§4 REGRESYON: superadminOnly'siz kategori kimlikten etkilenmez", () => {
    setIdentity(false, true);
    renderWithProviders(<FeatureFlagSection flags={[FLAG]} />);
    expect(screen.getByRole("switch")).toBeTruthy();
    expect(screen.queryByText(BANT)).toBeNull();
  });

  it("§5 izin yoksa kimlik kurtarmaz (kapı ÇARPIM)", () => {
    perm.mockImplementation(() => false);
    setIdentity(true, true);
    renderWithProviders(<FeatureFlagSection flags={[FLAG]} superadminOnly />);
    expect(screen.queryByRole("switch")).toBeNull();
    // Sebep izin eksikliği — kimlik bandı çizilmez (yanlış teşhis vermez).
    expect(screen.queryByText(BANT)).toBeNull();
  });
});

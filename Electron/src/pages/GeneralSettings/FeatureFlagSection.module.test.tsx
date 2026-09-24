// =============================================================================
// BEKÇİ — MODÜL KİLİDİ (satır DONAR; satıcı görünümü)
// =============================================================================
// NEDEN VAR: modül kapalıyken o modüle ait ayar satırlarının düzenlenmesi
// anlamsızdır (yazılan değerin uygulanacağı bir kayıt yolu yoktur).
//
// ⚠️ 2026-09-04 — BU BANDIN İZLEYİCİSİ DEĞİŞTİ: fabrika yöneticisi artık kapalı
// modülün satırlarını HİÇ GÖRMEZ (görünürlük süzgeci çağırandadır:
// `SettingsSurfacePage` → `filterCategoryByModules`, bekçisi
// `flag-modules.test.ts`). Buraya `moduleClosed` ile gelen bir kategori yalnız
// SATICI görünümünde çizilir; aşağıdaki ölçümler o görünümün sözleşmesidir ve
// olduğu gibi geçerli kalır (bant + salt-okunur + Kaydet yok).
//
// ÖLÇÜLENLER:
//   §1 Modül KAPALI → toggle yok · modül bandı var · Kaydet çubuğu yok ·
//      satırın SEBEP cümlesi de modülü söyler (izin cümlesi basmaz).
//   §2 Modül AÇIK → toggle var, bant yok.
//   §3 REGRESYON: `moduleClosed` taşımayan kategori etkilenmez.
//   §4 İKİ SEBEP BİRDEN (superadminOnly + moduleClosed) → İKİ bant. Bant
//      tekil olsaydı kullanıcı ilk engeli çözer, ikincisine çarpardı.
//   §5 Bant "etkisiz" DEMEZ — tasarımın tek-resolver kuralı (§3.6) backend'de
//      henüz yok; "bu ayarın etkisi yok" cümlesi bugün YALAN olurdu.
//   §6 İzin YOKSA modül açık olsa da yazılamaz (kapı ÇARPIM).
//
// NEGATİF SONDA (2026-09-03, dosya md5 ile birebir geri alındı):
//   ① `canEdit` sonundaki `&& !moduleClosed` düşürüldü → §1 kırmızı (3 kontrol).
//   ② `lockNotes` listesi tekil banda döndürüldü (yalnız ilk sebep basılır) →
//      §4 kırmızı (1 kontrol).
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
  useRoleAccess: () => ({
    hasPermission: (p: string) => perm(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => perm(p)),
  }),
}));

import { FeatureFlagSection } from "./FeatureFlagSection";

const FLAG: FlagDef = {
  key: "goodsReceiptRequirePriceEnabled",
  title: "Mal kabul satırında birim fiyat zorunlu olsun",
  summary: "Fiyatı çözülemeyen mal kabul kaydedilemez.",
  defaultOn: false,
  audience: ["Depocu"],
  desc: "Açıkken satırda birim fiyat yoksa mal kabul kaydedilemez.",
};

const MODUL_BANDI = /Ticaret modülü bu kurulumda kapalı/i;
const SUPERADMIN_BANDI = /yazılım firmanıza başvurun/i;

beforeEach(() => {
  perm.mockImplementation(() => true);
  flags.mockReturnValue({
    isLoading: false,
    data: { data: { goodsReceiptRequirePriceEnabled: true } },
  });
  useAuthStore.setState({ isSystemAccount: false, systemAccountExists: true });
});

describe("modül kilidi", () => {
  it("§1 modül KAPALI: salt-okunur + bant + Kaydet yok + doğru sebep", () => {
    renderWithProviders(
      <FeatureFlagSection flags={[FLAG]} moduleClosed moduleLabel="Ticaret" />,
    );
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText(MODUL_BANDI)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /kaydet/i })).toBeNull();
    // ⭐ Satır YANLIŞ TEŞHİS basmaz: sebep izin değil, kapalı modüldür.
    expect(screen.getByText(/Ticaret modülü kapalı — ayar dondu\./)).toBeTruthy();
    expect(screen.queryByText(/admin:settings/)).toBeNull();
    // Kilit GİZLEMEZ: ayarın başlığı ve KAYITLI değeri okunmaya devam eder.
    expect(screen.getByText(FLAG.title)).toBeTruthy();
    expect(screen.getByText("Açık")).toBeTruthy();
  });

  it("§2 modül AÇIK: yazılabilir, bant YOK", () => {
    renderWithProviders(
      <FeatureFlagSection flags={[FLAG]} moduleClosed={false} moduleLabel="Ticaret" />,
    );
    expect(screen.getByRole("switch")).toBeTruthy();
    expect(screen.queryByText(MODUL_BANDI)).toBeNull();
  });

  it("§3 REGRESYON: moduleClosed taşımayan kategori etkilenmez", () => {
    renderWithProviders(<FeatureFlagSection flags={[FLAG]} />);
    expect(screen.getByRole("switch")).toBeTruthy();
    expect(screen.queryByText(MODUL_BANDI)).toBeNull();
    expect(screen.queryByText(SUPERADMIN_BANDI)).toBeNull();
  });

  it("§4 ⭐ İKİ sebep birden → İKİ bant (liste, tekil değil)", () => {
    renderWithProviders(
      <FeatureFlagSection flags={[FLAG]} superadminOnly moduleClosed moduleLabel="Ticaret" />,
    );
    expect(screen.getByText(SUPERADMIN_BANDI)).toBeTruthy();
    expect(screen.getByText(MODUL_BANDI)).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
    // İki not da `role="note"` — sayısı da ölçülüyor (tekil banda dönerse 1).
    expect(screen.getAllByRole("note")).toHaveLength(2);
  });

  it("§5 ⭐ bant 'etkisiz' DEMEZ (tek-resolver kuralı backend'de henüz yok)", () => {
    renderWithProviders(
      <FeatureFlagSection flags={[FLAG]} moduleClosed moduleLabel="Ticaret" />,
    );
    const not = screen.getByText(MODUL_BANDI).textContent ?? "";
    expect(not).toMatch(/dondu/);
    expect(not).toMatch(/modül açılınca yeniden düzenlenebilir/i);
    // "etkisiz" / "çalışmaz" gibi bir vaat verilmez: üretim kapalı bir kurulumda
    // `kk1DuplicateGuardEnabled` hâlâ `/api/rolls` üzerinden koşuyor (ölçüldü).
    expect(not).not.toMatch(/etkisiz|çalışmaz|uygulanmaz/i);
  });

  it("§6 izin yoksa modül açık olsa da yazılamaz (kapı ÇARPIM)", () => {
    perm.mockImplementation(() => false);
    renderWithProviders(<FeatureFlagSection flags={[FLAG]} moduleLabel="Ticaret" />);
    expect(screen.queryByRole("switch")).toBeNull();
    // Sebep izin eksikliğidir → modül bandı çizilmez (yanlış teşhis yok).
    expect(screen.queryByText(MODUL_BANDI)).toBeNull();
  });

  it("§6b modül kapalı AMA izinsiz kullanıcıda modül bandı basılmaz", () => {
    perm.mockImplementation(() => false);
    renderWithProviders(
      <FeatureFlagSection flags={[FLAG]} moduleClosed moduleLabel="Ticaret" />,
    );
    // Kullanıcının asıl engeli izindir; modül bandı ona "modülü açtır" der ve
    // açtırsa bile yine yazamaz — yanlış yönlendirme.
    expect(screen.queryByText(MODUL_BANDI)).toBeNull();
  });
});

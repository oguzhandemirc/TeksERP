// =============================================================================
// BEKÇİ — SİSTEM PROFİLİ EKRANI (duman + üç davranış)
// =============================================================================
// ÖLÇÜLENLER:
//   §1 Satıcı: profil listesi + fark satırları ADIYLA çizilir ("N değişiklik"
//      soyut sayısı TEK BAŞINA yetmez — yıkıcı işlem onayı kuralı).
//   §2 Fabrika yöneticisi: salt-okunur bandı + "Uygula" düğmesi PASİF.
//   §3 ⭐ FAIL-CLOSED: ekran manifestosu okunamazsa "kapatırsan gizlenir"
//      önizlemesi çizilmez ve sebebi YAZILIR. Boş liste "hiçbir şey
//      gizlenmeyecek" YALANINI basardı.
//   §4 Yer tutucu modüller "yüzeyi yok" rozetiyle GÖSTERİLİR (kurulumun tam
//      fotoğrafı; Genel Ayarlar'da bilerek yoklar).
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";

vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ isAdmin: true, hasPermission: () => true }),
}));
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
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFeatureFlags: () => ({ isLoading: false, data: { data: { productionEnabled: true } } }),
  // Raporlar bölümü gerçek görünürlük ctx'ini çağırır; o da bunu okur.
  useShipmentConfirmationEnabled: () => false,
  // PIN kapalı → tutarsızlık bandı ayrıca ölçülüyor.
  useEnabledLoginMethods: () => ["list"],
}));
vi.mock("@/hooks/useWarehouses", () => ({
  useMultiWarehouse: () => ({
    multiWarehouse: false,
    warehouses: [
      { id: "1", isActive: true },
      { id: "2", isActive: true },
    ],
    isLoading: false,
  }),
}));

const profileGet = vi.fn();
vi.mock("@/services/moduleProfileService", () => ({
  moduleProfileService: { get: () => profileGet() },
}));
const screensList = vi.fn();
vi.mock("@/services/screenCatalogService", () => ({
  screenCatalogService: { list: () => screensList() },
}));

import { ModuleProfilePage } from "./ModuleProfilePage";

const PROFILE_STATE = {
  success: true,
  data: {
    profiles: [
      {
        id: "basit",
        ad: "Basit — İşlemeci",
        aciklama: "Yalnız üretim.",
        moduller: { "production.enabled": true },
      },
      {
        id: "standart",
        ad: "Standart",
        aciklama: "Üretim + ön muhasebe + ticaret.",
        moduller: { "production.enabled": true, "finance.enabled": true },
      },
    ],
    current: { values: {}, appliedProfile: "basit", closest: "basit" },
    diffs: {
      basit: [],
      standart: [
        { key: "finance.enabled", from: false, to: true },
        { key: "ticaret.enabled", from: false, to: true },
      ],
    },
  },
};

const SCREENS = {
  success: true,
  data: {
    screens: [
      {
        key: "operations/work-orders",
        app: "desktop",
        title: "İş Emirleri",
        requires: [],
        capabilities: [],
        modul: "productionEnabled",
      },
      // ⚠️ TABLET satırı fixture'da ZORUNLU: eskiden yalnız masaüstü girdisi
      //    vardı ve ekranın mobil ekranları yutması ÖLÇÜLEMİYORDU.
      {
        key: "kk1",
        app: "mobile",
        title: "KK1 (Ham Giriş)",
        requires: [],
        capabilities: [],
        modul: "productionEnabled",
      },
    ],
    withoutScreen: [],
  },
};

beforeEach(() => {
  profileGet.mockResolvedValue(PROFILE_STATE);
  screensList.mockResolvedValue(SCREENS);
  useAuthStore.setState({ isSystemAccount: true, systemAccountExists: true });
});

describe("Sistem Profili ekranı", () => {
  it("§1 satıcı: profiller + fark satırları ADIYLA çizilir", async () => {
    renderWithProviders(<ModuleProfilePage />);
    await waitFor(() => expect(screen.getByText("Standart")).toBeTruthy());
    // ⚠️ İKİ kez geçer ve bu doğru: "Bu kurulum: …" satırında + profil kartında.
    expect(screen.getAllByText("Basit — İşlemeci").length).toBe(2);
    // Uygulanmış profil rozeti + karşı tarafta uygula düğmesi.
    expect(screen.getByText("Uygulanmış")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Uygula \(2 değişiklik\)/ })).toBeTruthy();
    // ⭐ Soyut sayı TEK BAŞINA yetmez: her satır adıyla ve iki yönüyle yazılır.
    expect(screen.getByText("· Ön muhasebe: Kapalı → Açık")).toBeTruthy();
    expect(screen.getByText("· Ticaret: Kapalı → Açık")).toBeTruthy();
  });

  it("§1b kapatma etkisi ekran manifestosundan çizilir", async () => {
    renderWithProviders(<ModuleProfilePage />);
    await waitFor(() =>
      expect(
        screen.getByText(/Kapatılırsa gizlenen masaüstü ekranları \(1\): İş Emirleri/),
      ).toBeTruthy(),
    );
    // ⭐ Tablet ekranları AYRI ve ANILIR — modül kapanınca tablet DURUR
    // (backend `requireProductionEnabled` 403), satıcı bunu görmeden karar veremez.
    expect(screen.getByText(/ekranlar \(1\): KK1 \(Ham Giriş\)/)).toBeTruthy();
    // Bağımlılık oku TERS yönde anlatılır — İKİ modülde (üretim→[tezgah, dokuma],
    // ticaret→[iplik]); devere 2026-09-14'te BAĞIMSIZLAŞTI (K3: hazır/fason levent iplik
    // tüketmez), yani sayı da ölçülüyor.
    expect(screen.getAllByText(/Kapatılırsa birlikte kapanır:/)).toHaveLength(2);
    // Düz yön ÜÇ modülde (iplik←ticaret, tezgah←üretim, dokuma←üretim).
    expect(screen.getAllByText(/Açılabilmesi için önce/)).toHaveLength(3);
    // ⭐ Ticaret'in satırı İplik'i anar ama Devere'yi ANMAZ (bağımlılık kalktı) —
    // geçişli kapanış mekanizması (BFS) yerinde, zincir bugün tek halka.
    const ticaretSatiri = screen
      .getAllByText(/Kapatılırsa birlikte kapanır:/)
      .map((el) => el.textContent ?? "")
      .find((t) => t.includes("İplik"));
    expect(ticaretSatiri).not.toMatch(/Devere/);
  });

  it("§2 fabrika yöneticisi: salt-okunur bandı + Uygula PASİF", async () => {
    useAuthStore.setState({ isSystemAccount: false, systemAccountExists: true });
    renderWithProviders(<ModuleProfilePage />);
    await waitFor(() => expect(screen.getByText("Standart")).toBeTruthy());
    expect(screen.getByText(/Salt-okunur görünüm/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Uygula \(2 değişiklik\)/ })).toBeDisabled();
  });

  it("§3 ⭐ manifesto okunamazsa önizleme ÇİZİLMEZ ve sebebi yazılır", async () => {
    screensList.mockRejectedValue(new Error("403"));
    renderWithProviders(<ModuleProfilePage />);
    await waitFor(() => expect(screen.getByText(/Ekran listesi okunamadı/)).toBeTruthy());
    // Boş liste "hiçbir şey gizlenmeyecek" YALANINI basardı.
    expect(screen.queryByText(/Kapatılırsa gizlenen ekranlar/)).toBeNull();
    expect(screen.queryByText(/beyan edilmemiş/)).toBeNull();
  });

  it("§4 yer tutucu modüller 'yüzeyi yok' rozetiyle gösterilir", async () => {
    renderWithProviders(<ModuleProfilePage />);
    await waitFor(() => expect(screen.getByText(/Kumaş teknik kartı · yüzeyi yok/)).toBeTruthy());
    expect(screen.getByText(/Tezgah izleme · yüzeyi yok/)).toBeTruthy();
  });

  it("§5 tutarsızlık bantları: çoklu depo + PIN", async () => {
    renderWithProviders(<ModuleProfilePage />);
    await waitFor(() =>
      expect(screen.getByText(/2 aktif depo tanımlı ama Çoklu Depo modülü kapalı/)).toBeTruthy(),
    );
    expect(screen.getByText(/Giriş yöntemlerinde PIN kapalı/)).toBeTruthy();
  });
});

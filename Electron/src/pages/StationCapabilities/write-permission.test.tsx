// =============================================================================
// BEKÇİ — İSTASYON YETENEKLERİ YAZMA KAPISI (station:write)
// =============================================================================
// Rota bu ekranı `station:read` ile açar ve AÇIK KALMALI: liste okunabilir bir
// yüzeydir. Ama "Yetenekleri Düzenle" bir YAZMA yüzeyidir; backend PUT
// `/api/station-capabilities/:stationId` `station:write` ister
// (`Teks-Erp/src/routes/station-capability.routes.ts`). Panel bu kapıyı hiç
// koymuyordu: butonun tek koşulu `cap.canApplyProperty` idi — bu bir VERİ
// özelliğidir, izin yerine geçmez (ELECTRON.md [EL-22]).
//
// Sapmanın görünümü: salt-okunur kullanıcı butonu görür, sheet'i açar, seçim
// yapar, Kaydet'e basar ve 403'ü sunucudan yer. "Kapısız çıkış".
//
// İki kapı da ölçülür, çünkü sheet İKİ sayfadan açılıyor (bu sayfa + Üretim
// İstasyonları): ① listedeki buton ② sheet'in kendisi.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";
import { StationKind } from "@/types/enums";
import type { StationCapabilitySummary } from "./types";

const OZELLIK_VEREN: StationCapabilitySummary = {
  stationId: "st-1",
  stationCode: "IST-001",
  stationName: "Kurşun Hattı",
  stationKind: StationKind.PROCESS_QC,
  hasDefaultCategory: true,
  canApplyColor: false,
  canApplyProperty: true,
  canApplyQuality: false,
  colorCount: 0,
  propertyCount: 2,
};

vi.mock("./service", () => ({
  stationCapabilityService: {
    list: () => Promise.resolve({ success: true, data: [OZELLIK_VEREN] }),
    listDetailed: () => Promise.resolve({ success: true, data: [] }),
    getByStation: () => Promise.resolve({ success: true, data: null }),
    setCapabilities: () => Promise.resolve({ success: true, data: null }),
  },
}));
// Sayfa kabuğunun provider bağımlılıkları — bu bekçinin konusu değil.
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
    reorderFavorites: vi.fn(),
  }),
}));

import { StationCapabilitiesPage } from "./StationCapabilitiesPage";
import { CapabilitiesEditSheet } from "./CapabilitiesEditSheet";

const BUTON = /Yetenekleri Düzenle/;

function girisYap(permissions: string[]) {
  useAuthStore.setState({ user: { permissions } as unknown as JwtPayload });
}

beforeEach(() => {
  useAuthStore.setState({ user: null });
});

describe("İstasyon Yetenekleri — yazma kapısı", () => {
  it("zemin: yazma yetkisi olan kullanıcıya buton AÇIK gelir", async () => {
    // Körlük zemini: kapı her koşulda kapalı olsaydı "sızıntı yok" testi de
    // yeşil kalırdı ve ekran fiilen kullanılamaz olurdu.
    girisYap(["station:read", "station:write"]);
    renderWithProviders(<StationCapabilitiesPage />);
    const btn = await screen.findByRole("button", { name: BUTON });
    expect(btn).toBeEnabled();
  });

  it("yalnız station:read olan kullanıcı düzenleme butonuna BASAMAZ", async () => {
    girisYap(["station:read"]);
    renderWithProviders(<StationCapabilitiesPage />);
    const btn = await screen.findByRole("button", { name: BUTON });
    expect(btn).toBeDisabled();
  });

  it("domain wildcard (station:*) yazma sayılır", async () => {
    girisYap(["station:*"]);
    renderWithProviders(<StationCapabilitiesPage />);
    expect(await screen.findByRole("button", { name: BUTON })).toBeEnabled();
  });

  it("sheet KENDİ kapısını taşır — yetkisiz açılışta Kaydet yok", () => {
    girisYap(["station:read"]);
    renderWithProviders(
      <CapabilitiesEditSheet station={OZELLIK_VEREN} open onOpenChange={() => {}} />,
    );
    expect(screen.getByText("Değişiklik yetkiniz yok")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kaydet/ })).toBeNull();
  });
});

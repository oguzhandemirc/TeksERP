// =============================================================================
// Bekçi: ÇUVAL İZİ KATALOĞU ekranı (2026-09-04)
//   §1 Ekran ÇİZİLİYOR ve pasif satır GİZLENMİYOR — soluk + "Gizli" rozetiyle
//      görünür (katalogdan çıkarma bir görünürlük kararıdır, silme değil).
//   §2 ⭐ Yazma yetkisi YOKSA düzenleme tuşları ÇİZİLMEZ (gri buton olmayan bir
//      yolu vaat eder) — ekranın kendisi yine açılır.
// =============================================================================
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SackTagsPage } from "./SackTagsPage";

let canWrite = true;

vi.mock("@/services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("./service", async (orig) => {
  const real = await orig<typeof import("./service")>();
  return {
    ...real,
    sackTagService: {
      // ⚠️ Düz fonksiyon, `vi.fn().mockResolvedValue` DEĞİL: vitest yapılandırması
      // `restoreMocks: true` taşıyor ve testten önce implementasyonu söküyor →
      // liste boş dönerdi (ilk yazımda tam bu yüzden "kayıt yok" ölçüldü).
      list: () =>
        Promise.resolve([
          { id: "1", code: "KONTROL", name: "Kontrol edilecek", hex: "#DC2626", sortOrder: 10, isActive: true },
          { id: "2", code: "EKSIK", name: "Eksik var", hex: "#CA8A04", sortOrder: 20, isActive: false },
        ]),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      getAll: vi.fn(),
    },
  };
});

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: () => {} }),
}));

vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: () => canWrite,
    hasAnyPermission: () => canWrite,
    isAdmin: false,
    permissions: [],
    user: null,
  }),
}));

const draw = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SackTagsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("SackTagsPage", () => {
  it("§1 katalog çizilir; pasif satır GÖRÜNÜR ve 'Gizli' rozetiyle işaretlenir", async () => {
    canWrite = true;
    draw();
    expect(await screen.findByText("Kontrol edilecek")).toBeTruthy();
    expect(screen.getByText("Eksik var")).toBeTruthy();
    expect(screen.getByText("Gizli")).toBeTruthy();
  });

  it("§2 ⭐ yazma yetkisi yoksa düzenleme tuşları ÇİZİLMEZ (ekran yine açılır)", async () => {
    canWrite = false;
    draw();
    expect(await screen.findByText("Kontrol edilecek")).toBeTruthy();
    expect(screen.queryByText("Yeni Etiket")).toBeNull();
    expect(screen.queryByLabelText("Kontrol edilecek — düzenle")).toBeNull();
    expect(screen.queryByLabelText("Kontrol edilecek — sil")).toBeNull();
  });
});

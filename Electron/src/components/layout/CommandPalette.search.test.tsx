import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { CommandPalette } from "./CommandPalette";

/**
 * GLOBAL ARAMA — paletin SUNUCU tarafı (2026-08-19).
 *
 * `CommandPalette.test.tsx` statik katalogu (sayfa/rapor) kilitliyor; bu dosya
 * veri sonuçlarını kilitler. Ayrı dosya çünkü mock kurulumu farklı: burada
 * `apiClient` de sahtelenip zamanlayıcılar sahteleniyor.
 */

let permissions: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    user: null,
    permissions,
    isAdmin: false,
    hasPermission: (p: string) => permissions.includes(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => permissions.includes(p)),
    hasAllPermissions: (ps: string[]) => ps.every((p) => permissions.includes(p)),
  }),
}));
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: () => ({
    shipmentConfirmationEnabled: false,
    // Rapor kapısı (K5) ctx'ten okur; bu test arama davranışını ölçer, kapıyı açık sabitler.
    reportsClosedKeys: [],
    isReportOpen: () => true,
    flagsReady: true,
    flagsFailed: false,
  }),
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
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));

const openTab = vi.fn();
vi.mock("@/store/tabs", () => ({
  useTabsStore: (sel: (s: { openTab: unknown }) => unknown) => sel({ openTab }),
}));
vi.mock("@/store/auth", () => ({
  useAuthStore: (sel: (s: { logout: unknown }) => unknown) => sel({ logout: vi.fn() }),
}));

const get = vi.fn();
// ⚠️ BAYRAK KANCASI DA MOCK'LANIR (2026-09-01, birleştirme): palet artık
// `useFeatureFlags()` okuyor (gizlenen Envanter sekmelerinin derin bağlantıları
// paletten düşsün diye) ve o kanca `apiClient.get`e gider. Casus GLOBAL olduğu
// için o istek "sunucuya sordu" sayılıyordu — oysa testin iddiası ARAMA ucuna
// sorulmadığıdır. Diğer altı kanca gibi mock'lanır (dosyanın kendi deseni).
vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: { productionEnabled: true } } }),
}));
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

const reply = (data: unknown) => ({ data: { data } });
const render = () => renderWithProviders(<CommandPalette open onOpenChange={vi.fn()} />);
const type = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText(/ara/i), { target: { value: text } });

const CUSTOMER_GROUP = {
  entity: "customer",
  label: "Müşteriler",
  rows: [{ id: "c1", title: "ÇANAKKALE TEKSTİL", subtitle: null, code: "MUS-014" }],
  hasMore: false,
};

describe("komut paleti — global arama", () => {
  beforeEach(() => {
    permissions = ["customer:read", "item:read"];
    get.mockReset();
    openTab.mockReset();
    get.mockResolvedValue(reply({ term: "x", exact: null, groups: [CUSTOMER_GROUP] }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("2 harften kısa terimde SUNUCUYA HİÇ SORMAZ", async () => {
    render();
    type("a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(get).not.toHaveBeenCalled();
  });

  it("yazma bitince tek istek atar (her tuşta değil)", async () => {
    render();
    type("can");
    type("cana");
    type("canak");
    // 250 ms tam SINIR — birkaç ms fazlası, zamanlayıcı ile render döngüsünün
    // yarışmasını ortadan kaldırır (sınırda test flaky olur, davranış değil).
    await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(String(get.mock.calls[0]?.[0])).toContain("q=canak");
  });

  it("kayıt sonuçları listede çıkar", async () => {
    render();
    type("canakkale");
    await vi.advanceTimersByTimeAsync(250);
    expect(await screen.findByText("ÇANAKKALE TEKSTİL")).toBeTruthy();
  });

  it("ÇİFT SÜZME: sunucu satırı, terim başlıkta GEÇMESE BİLE görünür", async () => {
    // ⚠️ Bu testin varlık sebebi: cmdk'nın `filter`'ı HER satıra uygulanır.
    // Sunucu satırı alias üzerinden geldiyse (terim "belle", başlık "18152")
    // nöbet olmadan cmdk onu ELER — arama çalışır, sonuç görünmez.
    get.mockResolvedValue(
      reply({
        term: "belle",
        exact: null,
        groups: [
          {
            entity: "item",
            label: "Ürünler",
            rows: [{ id: "i1", title: "18152", subtitle: null, code: "18152" }],
            hasMore: false,
          },
        ],
      }),
    );
    render();
    type("belle");
    await vi.advanceTimersByTimeAsync(250);
    expect(await screen.findByText("18152")).toBeTruthy();
  });

  it("izinsiz kova ÇİZİLMEZ (sunucu satır göndermiş olsa bile)", async () => {
    permissions = ["item:read"]; // customer:read YOK
    render();
    type("canakkale");
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByText("ÇANAKKALE TEKSTİL")).toBeNull();
  });

  it("satıra tıklayınca DOĞRU hedefe gider", async () => {
    render();
    type("canakkale");
    await vi.advanceTimersByTimeAsync(250);
    fireEvent.click(await screen.findByText("ÇANAKKALE TEKSTİL"));
    expect(openTab).toHaveBeenCalledWith("/definitions/customers?search=MUS-014", undefined);
  });

  it("BİLİNMEYEN kova sessizce düşürülmez — uyarı çizilir", async () => {
    // İki proje ayrı sürümleniyor; backend'e yeni kova eklenip panel katalogu
    // güncellenmediğinde sonuç KAYBOLMAMALI, sebebi görünmeli.
    get.mockResolvedValue(
      reply({
        term: "x",
        exact: null,
        groups: [
          {
            entity: "gelecek_varlik",
            label: "Gelecek",
            rows: [{ id: "z", title: "Z", subtitle: null, code: "Z" }],
            hasMore: false,
          },
        ],
      }),
    );
    render();
    type("canakkale");
    await vi.advanceTimersByTimeAsync(250);
    expect(await screen.findByText(/hedef tanımlı değil/i)).toBeTruthy();
  });

  it("tam barkod → 'Okutulan kod' grubu", async () => {
    permissions = ["roll:read"];
    get.mockResolvedValue(
      reply({
        term: "T120726H0001",
        exact: {
          entity: "roll",
          row: { id: "r1", title: "T120726H0001", subtitle: "PATOS", code: "T120726H0001" },
        },
        groups: [],
      }),
    );
    render();
    type("T120726H0001");
    await vi.advanceTimersByTimeAsync(250);
    expect(await screen.findByText("Okutulan kod")).toBeTruthy();
  });

  it("UÇ PATLASA BİLE palet çalışır (statik katalog durur)", async () => {
    get.mockRejectedValue(new Error("500"));
    render();
    type("canakkale");
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    // Palet hâlâ ayakta: arama kutusu duruyor, çökme yok.
    expect(screen.getByPlaceholderText(/ara/i)).toBeTruthy();
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { MenuLayoutView } from "@/services/menuLayoutService";
import { groupScreens, presetPreview, sameKeySet } from "./menu-layout-tree";
import { MenuLayoutPage } from "./MenuLayoutPage";

/**
 * K19 Menü Düzeni ekranı: hazır set ÖNİZLEMELİ (gizlenecek her ekran + neden listelenir, Kaydet'e kadar yazılmaz),
 * gizlenemez satır kilitli + açıklamalı, "Tümünü göster" listeyi boşaltır, gövde yalnız değişen alanı taşır.
 */
const view = (over: Partial<MenuLayoutView> = {}): MenuLayoutView => ({
  hiddenScreens: [],
  advancedGroup: false,
  unhideable: [{ key: "system/menu-layout", reason: "Gizlenen ekranları geri açan yer burası." }],
  advancedScreens: ["system/perf"],
  presets: [
    {
      id: "fason-hizmet",
      label: "Fason hizmet firması",
      description: "d",
      screens: [
        { key: "operations/kartela", app: "desktop", title: "Kartela", reason: "Kartela gönderilmiyor." },
        { key: "KK1", app: "mobile", title: "Ham Giriş", reason: "Ham giriş yok." },
      ],
    },
  ],
  ...over,
});
let server = view();
const update = vi.fn();
vi.mock("@/services/menuLayoutService", () => ({
  getMenuLayout: () => Promise.resolve(server),
  updateMenuLayout: (b: unknown) => update(b),
}));
vi.mock("@/services/screenCatalogService", () => ({
  screenCatalogService: {
    list: () =>
      Promise.resolve({
        data: {
          withoutScreen: [],
          screens: [
            { key: "operations/kartela", app: "desktop", title: "Kartela", requires: [], capabilities: [] },
            { key: "system/menu-layout", app: "desktop", title: "Menü Düzeni", requires: [], capabilities: [] },
            { key: "system/perf", app: "desktop", title: "Endpoint Performansı", requires: [], capabilities: [] },
            { key: "KK1", app: "mobile", title: "Ham Giriş", requires: [], capabilities: [] },
          ],
        },
      }),
  },
}));

// Sayfa kabuğunun (PageHeader → favoriler/yoğunluk) provider bağımlılıkları — bu bekçinin konusu değil.
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }),
}));
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: { density: "comfortable" }, setPreference: vi.fn() }),
}));

describe("menu-layout-tree", () => {
  it("masaüstü ekranları menü grubuna, tablet ekranları ayrı bölüme", () => {
    const g = groupScreens([
      { key: "system/perf", app: "desktop", title: "P", requires: [], capabilities: [] },
      { key: "Tambur", app: "mobile", title: "T", requires: [], capabilities: [] },
      { key: "garip", app: "desktop", title: "G", requires: [], capabilities: [] },
    ]);
    expect(g.map((x) => x.id)).toEqual(["system", "other", "mobile"]);
  });
  it("önizleme: zaten gizli ve gizlenemez düşer", () => {
    const p = view().presets[0]!;
    expect(presetPreview(p, new Set(["KK1"]), new Set()).map((s) => s.key)).toEqual(["operations/kartela"]);
    expect(presetPreview(p, new Set(), new Set(["KK1"])).map((s) => s.key)).toEqual(["operations/kartela"]);
  });
  it("sameKeySet sırayı önemsemez", () => {
    expect(sameKeySet(new Set(["a", "b"]), ["b", "a"])).toBe(true);
    expect(sameKeySet(new Set(["a"]), ["a", "b"])).toBe(false);
  });
});

describe("MenuLayoutPage", () => {
  beforeEach(() => {
    server = view();
    update.mockReset();
    update.mockImplementation((b: { hiddenScreens?: string[] }) => Promise.resolve(view({ hiddenScreens: b.hiddenScreens ?? [] })));
  });

  it("varsayılan: hiçbiri gizli değil; gizlenemez satır kilitli ve açıklamalı, düğmesi yok", async () => {
    renderWithProviders(<MenuLayoutPage />);
    expect(await screen.findByText("Hiçbir ekran gizli değil (varsayılan).")).toBeInTheDocument();
    const locked = screen.getByTestId("menu-row-system/menu-layout");
    expect(within(locked).getByText(/Gizlenemez — Gizlenen ekranları geri açan yer/)).toBeInTheDocument();
    expect(screen.queryByTestId("menu-toggle-system/menu-layout")).not.toBeInTheDocument();
    expect(screen.getByTestId("menu-group-mobile")).toHaveTextContent("Ham Giriş");
    expect(screen.getByTestId("menu-save")).toBeDisabled();
  });

  it("⭐ hazır set → önizleme her ekranı nedeniyle listeler; onay yalnız taslağa yazar; Kaydet tam listeyi gönderir", async () => {
    renderWithProviders(<MenuLayoutPage />);
    fireEvent.click(await screen.findByTestId("menu-preset-fason-hizmet"));
    const list = await screen.findByTestId("menu-preset-preview");
    expect(within(list).getByText("Kartela")).toBeInTheDocument();
    expect(within(list).getByText("Ham giriş yok.")).toBeInTheDocument();
    expect(within(list).getByText("(tablet)")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("menu-preset-confirm"));
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByTestId("menu-hidden-count")).toHaveTextContent("2 ekran menüden gizli.");
    fireEvent.click(screen.getByTestId("menu-save"));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const body = update.mock.calls[0]![0] as { hiddenScreens: string[]; advancedGroup?: boolean };
    expect([...body.hiddenScreens].sort()).toEqual(["KK1", "operations/kartela"]);
    expect("advancedGroup" in body).toBe(false);
  });

  it("Tümünü göster listeyi boşaltır; Gelişmiş anahtarı yalnız kendi alanını gönderir", async () => {
    server = view({ hiddenScreens: ["KK1"] });
    renderWithProviders(<MenuLayoutPage />);
    expect(await screen.findByText("1 ekran menüden gizli.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("menu-show-all"));
    expect(screen.getByTestId("menu-hidden-count")).toHaveTextContent("Hiçbir ekran gizli değil");
    fireEvent.click(screen.getByTestId("menu-show-all").ownerDocument.getElementById("menu-advanced-group")!);
    fireEvent.click(screen.getByTestId("menu-save"));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ hiddenScreens: [], advancedGroup: true }));
  });
});

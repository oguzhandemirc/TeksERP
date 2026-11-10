// Bekçi — tek satır filtre çubuğu: ✕ yalnız kendi filtresini, "Temizle" hepsini kaldırır;
// "+ Filtre" kutu ekler; satır hiçbir genişlikte sarmaz (sınıf sözleşmesi — jsdom CSS hesaplamaz).
import { useSyncExternalStore } from "react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { FilterRow, FILTER_ROW_CLASS, FILTER_ROW_SCROLL_CLASS } from "./FilterRow";
import type { RowFilter } from "./row-filter";
import type { AppPreferences } from "@/types/preferences";
import type { PreferencePatch } from "@/providers/PreferencesProvider";

const store = vi.hoisted(() => {
  let prefs: AppPreferences = {};
  const subs = new Set<() => void>();
  return {
    get: () => prefs,
    set: (p: AppPreferences) => ((prefs = p), subs.forEach((s) => s())),
    subscribe: (s: () => void) => (subs.add(s), () => void subs.delete(s)),
  };
});
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({
    prefs: useSyncExternalStore(store.subscribe, store.get),
    setPreference: (p: PreferencePatch) => store.set({ ...store.get(), ...(typeof p === "function" ? p(store.get()) : p) }),
  }),
}));
beforeEach(() => store.set({}));

function Probe() {
  return <output data-testid="url">{decodeURIComponent(useLocation().search)}</output>;
}

const f = (id: string, keys: string[], extra: Partial<RowFilter> = {}): RowFilter => ({
  id,
  label: id.toUpperCase(),
  keys,
  render: () => <span>{id}-kutu</span>,
  ...extra,
});

function setup(initial: string, primary: RowFilter[], more: RowFilter[] = []) {
  render(
    <MemoryRouter initialEntries={[initial]}>
      <FilterRow search="" onSearchChange={() => {}} primary={primary} more={more} trailing={<span>SAG</span>} />
      <Probe />
    </MemoryRouter>,
  );
  return () => screen.getByTestId("url").textContent ?? "";
}

describe("FilterRow — aktif filtreyi kaldırmak", () => {
  it("dolu kutu vurgulu ve ✕ taşır; ✕ YALNIZ o filtrenin anahtarlarını siler (arama kalır)", () => {
    const url = setup("/?filter[a]=1&filter[b]=2&search=xx&cursor=c", [f("a", ["filter[a]"]), f("b", ["filter[b]"])]);
    expect(screen.getByTestId("filter-chip-a")).toHaveAttribute("data-active", "true");
    fireEvent.click(screen.getByRole("button", { name: "A filtresini kaldır" }));
    expect(url()).toBe("?filter[b]=2&search=xx");
  });

  it("boş ana kutuda ✕ yok", () => {
    setup("/", [f("a", ["filter[a]"])]);
    expect(screen.getByTestId("filter-chip-a")).toHaveAttribute("data-active", "false");
    expect(screen.queryByRole("button", { name: "A filtresini kaldır" })).toBeNull();
  });

  it("Temizle: hiçbir filtre yokken görünmez; varken HEPSİNİ tek yazımda kaldırır, arama kalır, yerel durum da sıfırlanır", () => {
    const onClear = vi.fn();
    const local = f("iptal", [], { active: true, onClear });
    const url = setup("/?filter[a]=1&dateField=deadline&dateTo=z&search=q", [f("a", ["filter[a]"]), f("d", ["dateField", "dateFrom", "dateTo"])], [local]);
    fireEvent.click(screen.getByRole("button", { name: /Temizle/ }));
    expect(url()).toBe("?search=q");
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("Temizle yalnız dateField varken çıkmaz (dateField tek başına süzmez)", () => {
    setup("/?dateField=createdAt", [f("d", ["dateField", "dateFrom", "dateTo"])]);
    expect(screen.queryByRole("button", { name: /Temizle/ })).toBeNull();
  });
});

describe("FilterRow — + Filtre (tikli seçim, çakılı kutu yok)", () => {
  const openMenu = () => {
    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    return within(screen.getByRole("menu"));
  };

  it("menü BÜTÜN filtreleri listeler; satırda görünenler tikli", () => {
    setup("/?filter[colorId]=r1", [f("a", ["filter[a]"])], [f("kumas", ["filter[itemId]"]), f("renk", ["filter[colorId]"])]);
    const menu = openMenu();
    expect(menu.getByRole("menuitemcheckbox", { name: "A" })).toHaveAttribute("aria-checked", "true");
    expect(menu.getByRole("menuitemcheckbox", { name: "KUMAS" })).toHaveAttribute("aria-checked", "false");
    // URL'de etkin olan "daha fazla" filtresi görünür ve tikli.
    expect(menu.getByRole("menuitemcheckbox", { name: "RENK" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("filter-chip-renk")).toHaveAttribute("data-active", "true");
  });

  it("tiksize dokununca kutu satıra eklenir; eklenmiş boş kutunun ✕'i kutuyu kapatır", () => {
    setup("/", [], [f("kumas", ["filter[itemId]"]), f("renk", ["filter[colorId]"])]);
    expect(screen.queryByTestId("filter-chip-kumas")).toBeNull();
    fireEvent.click(openMenu().getByRole("menuitemcheckbox", { name: "KUMAS" }));
    expect(screen.getByTestId("filter-chip-kumas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "KUMAS filtresini kaldır" }));
    expect(screen.queryByTestId("filter-chip-kumas")).toBeNull();
  });

  it("⭐ varsayılan (eski çakılı) kutu tikliye dokununca satırdan kalkar", () => {
    setup("/", [f("a", ["filter[a]"]), f("b", ["filter[b]"])]);
    fireEvent.click(openMenu().getByRole("menuitemcheckbox", { name: "A" }));
    expect(screen.queryByTestId("filter-chip-a")).toBeNull();
    expect(screen.getByTestId("filter-chip-b")).toBeInTheDocument();
    expect(within(screen.getByRole("menu")).getByRole("menuitemcheckbox", { name: "A" })).toHaveAttribute("aria-checked", "false");
  });

  it("⭐ değeri dolu kutu gizlenince değeri temizlenir (yalnız kendi anahtarları), yerel durum da sıfırlanır", () => {
    const onClear = vi.fn();
    const url = setup("/?filter[a]=1&filter[b]=2&search=q", [f("a", ["filter[a]"]), f("b", ["filter[b]"]), f("loc", [], { active: true, onClear })]);
    fireEvent.click(openMenu().getByRole("menuitemcheckbox", { name: "A" }));
    expect(url()).toBe("?filter[b]=2&search=q");
    expect(screen.queryByTestId("filter-chip-a")).toBeNull();
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitemcheckbox", { name: "LOC" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("Varsayılana dön: kaldırılan varsayılan geri gelir, eklenen kalkar ve değeri temizlenir", () => {
    const url = setup("/?search=q", [f("a", ["filter[a]"])], [f("kumas", ["filter[itemId]"])]);
    fireEvent.click(openMenu().getByRole("menuitemcheckbox", { name: "A" }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitemcheckbox", { name: "KUMAS" }));
    expect(screen.queryByTestId("filter-chip-a")).toBeNull();
    expect(screen.getByTestId("filter-chip-kumas")).toBeInTheDocument();
    fireEvent.click(openMenu().getByRole("menuitem", { name: /Varsayılana dön/ }));
    expect(screen.getByTestId("filter-chip-a")).toBeInTheDocument();
    expect(screen.queryByTestId("filter-chip-kumas")).toBeNull();
    expect(url()).toBe("?search=q");
  });

  it("onAdd taşıyan filtre kutu açmadan doğrudan etkinleşir", () => {
    const onAdd = vi.fn();
    setup("/", [], [f("iptal", [], { active: false, onAdd })]);
    fireEvent.click(openMenu().getByRole("menuitemcheckbox", { name: "IPTAL" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});

describe("FilterRow — TEK SATIR sözleşmesi", () => {
  it("kök sarmaz (flex-nowrap, flex-wrap YOK); kutu bölgesi yatay kayar ve daralabilir", () => {
    setup("/", [f("a", ["filter[a]"])]);
    const row = screen.getByTestId("filter-row");
    expect(row.className).toBe(FILTER_ROW_CLASS);
    expect(FILTER_ROW_CLASS).toContain("flex-nowrap");
    expect(FILTER_ROW_CLASS).toContain("shrink-0");
    expect(FILTER_ROW_CLASS).not.toMatch(/(^|\s)flex-wrap/);
    const scroll = screen.getByTestId("filter-row-scroll");
    expect(scroll.className).toContain(FILTER_ROW_SCROLL_CLASS);
    for (const c of ["overflow-x-auto", "min-w-0", "shrink", "flex-nowrap"]) expect(FILTER_ROW_SCROLL_CLASS).toContain(c);
    // Kutular kaydırma bölgesinde; sağ uç (trailing) onun DIŞINDA → hep görünür.
    expect(within(scroll).getByTestId("filter-chip-a")).toBeInTheDocument();
    expect(within(scroll).queryByText("SAG")).toBeNull();
  });

  it("⭐ '+ Filtre' kaydırma bölgesinin DIŞINDA (kutular kaysa da hep görünür)", () => {
    setup("/", [f("a", ["filter[a]"])], [f("kumas", ["filter[itemId]"])]);
    expect(within(screen.getByTestId("filter-row-scroll")).queryByRole("button", { name: "Filtre ekle" })).toBeNull();
    expect(screen.getByRole("button", { name: "Filtre ekle" })).toBeInTheDocument();
  });

  it("⭐ dar ekranda (lg altı) boş kutu satırdan kalkar ve menüde 'Aç' ile açılır; etkin kutu hep satırda", () => {
    setup("/?filter[b]=1", [f("a", ["filter[a]"]), f("b", ["filter[b]"])], [f("kumas", ["filter[itemId]"])]);
    expect(screen.getByTestId("filter-chip-a").className).toContain("hidden lg:inline-flex");
    expect(screen.getByTestId("filter-chip-b").className).not.toContain("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    const menu = within(screen.getByRole("menu"));
    expect(menu.getByRole("menuitem", { name: "A aç" }).className).toContain("lg:hidden");
    expect(menu.queryByRole("menuitem", { name: "B aç" })).toBeNull();
    expect(menu.queryByRole("menuitem", { name: "KUMAS aç" })).toBeNull();
    fireEvent.click(menu.getByRole("menuitem", { name: "A aç" }));
    expect(screen.getByTestId("filter-chip-a").className).not.toContain("hidden");
  });

  it("⭐ filtre varsa '+ Filtre' hep çizilir (kaldırmak için de); filtre yoksa çizilmez", () => {
    setup("/?filter[a]=1", [f("a", ["filter[a]"])]);
    expect(screen.getByRole("button", { name: "Filtre ekle" }).className).not.toContain("lg:hidden");
    cleanup();
    setup("/", []);
    expect(screen.queryByRole("button", { name: "Filtre ekle" })).toBeNull();
  });
});

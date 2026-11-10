// Bekçi — filtre satırı görünürlük seçimi kullanıcı tercihinde SAYFA BAŞINA kalıcı; kayıt yalnız
// varsayılandan sapmayı taşır; gizli kutuya URL/kayıtlı görünümden değer gelirse kutu görünür.
import { useSyncExternalStore } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AppPreferences } from "@/types/preferences";
import type { PreferencePatch } from "@/providers/PreferencesProvider";
import { FilterRow } from "./FilterRow";
import { readOverrides, withOverride } from "./filter-visibility";
import type { RowFilter } from "./row-filter";

const store = vi.hoisted(() => {
  let prefs: AppPreferences = {};
  const subs = new Set<() => void>();
  return {
    get: () => prefs,
    set: (p: AppPreferences) => {
      prefs = p;
      subs.forEach((s) => s());
    },
    subscribe: (s: () => void) => {
      subs.add(s);
      return () => subs.delete(s);
    },
  };
});

vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => {
    const prefs = useSyncExternalStore(store.subscribe, store.get);
    return {
      prefs,
      ready: true,
      resetPreferences: () => {},
      setPreference: (patch: PreferencePatch) => {
        const cur = store.get();
        store.set({ ...cur, ...(typeof patch === "function" ? patch(cur) : patch) });
      },
    };
  },
}));

const f = (id: string, keys: string[]): RowFilter => ({ id, label: id.toUpperCase(), keys, render: () => <span>{id}</span> });
const PRIMARY = [f("a", ["filter[a]"]), f("b", ["filter[b]"])];
const MORE = [f("kumas", ["filter[itemId]"])];

function mount(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <FilterRow search="" onSearchChange={() => {}} primary={PRIMARY} more={MORE} />
    </MemoryRouter>,
  );
}
/** Kaldırırken menü açık kalır; yalnız kapalıysa aç. */
const toggle = (name: string) => {
  if (!screen.queryByRole("menu")) fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitemcheckbox", { name }));
};

beforeEach(() => store.set({}));

describe("filtre satırı görünürlüğü — kalıcılık", () => {
  it("seçim sayfa (pathname) başına yazılır ve yeniden açılışta korunur; başka sayfa etkilenmez", () => {
    mount("/sevk");
    toggle("A");
    toggle("KUMAS");
    expect(store.get().filterRowVisibility).toEqual({ "/sevk": { a: false, kumas: true } });
    cleanup();
    mount("/sevk");
    expect(screen.queryByTestId("filter-chip-a")).toBeNull();
    expect(screen.getByTestId("filter-chip-kumas")).toBeInTheDocument();
    cleanup();
    mount("/siparis");
    expect(screen.getByTestId("filter-chip-a")).toBeInTheDocument();
    expect(screen.queryByTestId("filter-chip-kumas")).toBeNull();
  });

  it("Varsayılana dön sayfanın kaydını siler", () => {
    store.set({ filterRowVisibility: { "/sevk": { a: false }, "/diger": { b: false } } });
    mount("/sevk");
    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /Varsayılana dön/ }));
    expect(store.get().filterRowVisibility).toEqual({ "/diger": { b: false } });
    expect(screen.getByTestId("filter-chip-a")).toBeInTheDocument();
  });

  it("⭐ gizli kutuya URL'den (kayıtlı görünüm/filtre kaydı) değer gelirse kutu görünür ve tiklidir", () => {
    store.set({ filterRowVisibility: { "/sevk": { a: false } } });
    mount("/sevk?filter[a]=x");
    expect(screen.getByTestId("filter-chip-a")).toHaveAttribute("data-active", "true");
    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    expect(within(screen.getByRole("menu")).getByRole("menuitemcheckbox", { name: "A" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("filter-visibility saf model", () => {
  it("varsayılana eşit seçim kayıttan düşer", () => {
    expect(withOverride({ a: false }, "a", true, true)).toEqual({});
    expect(withOverride({}, "k", true, false)).toEqual({ k: true });
  });
  it("bozuk kayıt yok sayılır", () => {
    expect(readOverrides(null)).toEqual({});
    expect(readOverrides(["a"])).toEqual({});
    expect(readOverrides({ a: false, b: "x" })).toEqual({ a: false });
  });
});

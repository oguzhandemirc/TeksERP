// Bekçi — tek satır filtre çubuğu: ✕ yalnız kendi filtresini, "Temizle" hepsini kaldırır;
// "+ Filtre" kutu ekler; satır hiçbir genişlikte sarmaz (sınıf sözleşmesi — jsdom CSS hesaplamaz).
import { describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { FilterRow, FILTER_ROW_CLASS, FILTER_ROW_SCROLL_CLASS } from "./FilterRow";
import type { RowFilter } from "./row-filter";

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

describe("FilterRow — + Filtre", () => {
  it("seçilen filtre satıra kutu olarak eklenir; eklenmiş boş kutunun ✕'i kutuyu kapatır", () => {
    setup("/", [], [f("kumas", ["filter[itemId]"]), f("renk", ["filter[colorId]"])]);
    expect(screen.queryByTestId("filter-chip-kumas")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Filtre/ }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "KUMAS" }));
    expect(screen.getByTestId("filter-chip-kumas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "KUMAS filtresini kaldır" }));
    expect(screen.queryByTestId("filter-chip-kumas")).toBeNull();
  });

  it("URL'de etkin olan 'daha fazla' filtresi eklemeden kutu olarak görünür ve menüde tekrar çıkmaz", () => {
    setup("/?filter[colorId]=r1", [], [f("kumas", ["filter[itemId]"]), f("renk", ["filter[colorId]"])]);
    expect(screen.getByTestId("filter-chip-renk")).toHaveAttribute("data-active", "true");
    fireEvent.click(screen.getByRole("button", { name: /Filtre/ }));
    expect(within(screen.getByRole("menu")).queryByRole("menuitem", { name: "RENK" })).toBeNull();
  });

  it("onAdd taşıyan filtre kutu açmadan doğrudan etkinleşir", () => {
    const onAdd = vi.fn();
    setup("/", [], [f("iptal", [], { active: false, onAdd })]);
    fireEvent.click(screen.getByRole("button", { name: /Filtre/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "IPTAL" }));
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

  it("⭐ dar ekranda (lg altı) boş kalıcı kutu satırdan kalkar ve menüde çıkar; etkin kutu hep satırda", () => {
    setup("/?filter[b]=1", [f("a", ["filter[a]"]), f("b", ["filter[b]"])], [f("kumas", ["filter[itemId]"])]);
    expect(screen.getByTestId("filter-chip-a").className).toContain("hidden lg:inline-flex");
    expect(screen.getByTestId("filter-chip-b").className).not.toContain("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    const menu = within(screen.getByRole("menu"));
    expect(menu.getByRole("menuitem", { name: "A" }).className).toContain("lg:hidden");
    expect(menu.getByRole("menuitem", { name: "KUMAS" }).className).not.toContain("lg:hidden");
    expect(menu.queryByRole("menuitem", { name: "B" })).toBeNull();
  });

  it("⭐ eklenecek filtre yoksa '+ Filtre' çizilmez; yalnız dar-ekran kutuları varsa geniş ekranda gizli", () => {
    setup("/?filter[a]=1", [f("a", ["filter[a]"])]);
    expect(screen.queryByRole("button", { name: "Filtre ekle" })).toBeNull();
    cleanup();
    setup("/", [f("a", ["filter[a]"])]);
    expect(screen.getByRole("button", { name: "Filtre ekle" }).className).toContain("lg:hidden");
    cleanup();
    setup("/", [f("a", ["filter[a]"])], [f("kumas", ["filter[itemId]"])]);
    expect(screen.getByRole("button", { name: "Filtre ekle" }).className).not.toContain("lg:hidden");
  });
});


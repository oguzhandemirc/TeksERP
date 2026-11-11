import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { NavItem } from "./nav-config";
import { NavItemLink } from "./sidebar-items";

/**
 * Menü sağ tık menüsü (kullanıcı 2026-11-12): sağ tık arka planda sekme AÇMAZ, menü açar;
 * "Yeni sekmede aç" zorla yeni sekme, "Bu sekmede aç" aktif sekme, favori ekle/çıkar.
 * Orta tık ve Ctrl/⌘+tık eskisi gibi tıklama kararından (`decideTabOpen`) yeni sekme açar.
 */
const openTab = vi.fn();
const navigateActive = vi.fn();
const toggleFavorite = vi.fn();
let favorites: string[] = [];

vi.mock("@/store/tabs", () => ({
  useTabsStore: (sel: (s: unknown) => unknown) => sel({ tabs: [], activeId: null, openTab, navigateActive }),
  selectActivePath: () => null,
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites, isFavorite: (to: string) => favorites.includes(to), toggleFavorite }),
}));
vi.mock("./tabs/tab-open-mode", () => ({ getTabOpenMode: () => "newTab" }));

const ITEM = { label: "Siparişler", to: "/operations/orders", icon: () => null } as unknown as NavItem;
const row = () => screen.getByRole("button", { name: /Siparişler/ });

describe("menü öğesi sağ tık menüsü", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    favorites = [];
  });

  it("sağ tık sekme açmaz, menüyü açar; 'Yeni sekmede aç' zorla yeni sekme", () => {
    render(<NavItemLink item={ITEM} />);
    fireEvent.contextMenu(row());
    expect(openTab).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: /Yeni sekmede aç/ }));
    expect(openTab).toHaveBeenCalledWith("/operations/orders", { forceNew: true });
  });

  it("'Bu sekmede aç' aktif sekmede gezinir", () => {
    render(<NavItemLink item={ITEM} />);
    fireEvent.contextMenu(row());
    fireEvent.click(screen.getByRole("menuitem", { name: /Bu sekmede aç/ }));
    expect(navigateActive).toHaveBeenCalledWith("/operations/orders");
  });

  it("favori ekle / çıkar etiketi duruma göre değişir", () => {
    const { unmount } = render(<NavItemLink item={ITEM} />);
    fireEvent.contextMenu(row());
    fireEvent.click(screen.getByRole("menuitem", { name: "Favorilere ekle" }));
    expect(toggleFavorite).toHaveBeenCalledWith("/operations/orders");
    unmount();
    favorites = ["/operations/orders"];
    render(<NavItemLink item={ITEM} />);
    fireEvent.contextMenu(row());
    expect(screen.getByRole("menuitem", { name: "Favorilerden çıkar" })).toBeTruthy();
  });

  it("orta tık ve Ctrl+tık yeni sekme açar", () => {
    render(<NavItemLink item={ITEM} />);
    fireEvent(row(), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(openTab).toHaveBeenLastCalledWith("/operations/orders", expect.objectContaining({ forceNew: true, background: true }));
    fireEvent.click(row(), { ctrlKey: true });
    expect(openTab).toHaveBeenLastCalledWith("/operations/orders", expect.objectContaining({ forceNew: true, background: false }));
  });

  it("Shift+F10 ve menü tuşu klavyeyle menüyü açar", () => {
    const { unmount } = render(<NavItemLink item={ITEM} />);
    fireEvent.keyDown(row(), { key: "F10", shiftKey: true });
    expect(screen.getByRole("menuitem", { name: /Yeni sekmede aç/ })).toBeTruthy();
    unmount();
    render(<NavItemLink item={ITEM} />);
    fireEvent.keyDown(row(), { key: "ContextMenu" });
    expect(screen.getByRole("menuitem", { name: /Bu sekmede aç/ })).toBeTruthy();
  });

  it("kapalı modül satırında menü yok (tık yalnız ipucu)", () => {
    render(<NavItemLink item={{ ...ITEM, offHint: "Ayarlar › Modüller" }} />);
    fireEvent.contextMenu(row());
    expect(screen.queryByRole("menuitem")).toBeNull();
  });
});

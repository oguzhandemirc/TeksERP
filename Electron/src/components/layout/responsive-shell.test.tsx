import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";

/**
 * UX-3 responsive kabuk sondası (jsdom yerleşim hesaplamaz — taşmanın kendisi e2e
 * `UX1..` adımlarında ölçülür; burada DAVRANIŞ ve sınıf sözleşmesi kilitlenir).
 */

vi.mock("./Sidebar", () => ({
  Sidebar: ({ collapsed }: { collapsed: boolean }) => (
    <aside data-testid="sidebar" data-collapsed={String(collapsed)}>
      <nav>
        <button type="button">Operasyon</button>
      </nav>
    </aside>
  ),
}));

let activePath = "/";
vi.mock("@/store/tabs", () => ({
  useTabsStore: (sel: (s: { tabs: { id: string; path: string }[]; activeId: string }) => unknown) =>
    sel({ tabs: [{ id: "t1", path: activePath }], activeId: "t1" }),
}));

import { ShellSidebar } from "./ShellSidebar";
import { useMediaQuery, NARROW_SHELL_QUERY } from "@/hooks/useMediaQuery";

describe("ShellSidebar — ≤1024 px çekmece", () => {
  it("geniş kabukta satır-içi kenar çubuğu, çekmece/karartma yok", () => {
    render(<ShellSidebar narrow={false} collapsed drawerOpen={false} onCloseDrawer={() => {}} />);
    expect(screen.getByTestId("sidebar").dataset.collapsed).toBe("true");
    expect(screen.queryByTestId("sidebar-drawer")).toBeNull();
  });

  it("dar kabukta kapalıyken hiç yer kaplamaz", () => {
    render(<ShellSidebar narrow collapsed={false} drawerOpen={false} onCloseDrawer={() => {}} />);
    expect(screen.queryByTestId("sidebar")).toBeNull();
  });

  it("açık çekmece tam genişlikte menü çizer; karartma, Esc ve menü seçimi kapatır", () => {
    const close = vi.fn();
    // Geniş tercih ikon rayı olsa da çekmece hep etiketli menüdür.
    render(<ShellSidebar narrow collapsed drawerOpen onCloseDrawer={close} />);
    expect(screen.getByTestId("sidebar").dataset.collapsed).toBe("false");
    expect(screen.getByRole("dialog", { name: "Menü" })).toBeTruthy();

    fireEvent.click(screen.getByTestId("sidebar-drawer-backdrop"));
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Operasyon" }));
    expect(close).toHaveBeenCalledTimes(3);
  });

  it("sekme yolu değişince açık çekmece kapanır (diyalog/sayfa üstünde kalmaz)", () => {
    const close = vi.fn();
    activePath = "/";
    const { rerender } = render(<ShellSidebar narrow collapsed={false} drawerOpen onCloseDrawer={close} />);
    close.mockClear();
    activePath = "/operations/rolls";
    rerender(<ShellSidebar narrow collapsed={false} drawerOpen onCloseDrawer={close} />);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("useMediaQuery", () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it("matchMedia yoksa geniş (bugünkü) yerleşim: false", () => {
    // @ts-expect-error jsdom: bilinçli olarak kaldırılır
    window.matchMedia = undefined;
    const { result } = renderHook(() => useMediaQuery(NARROW_SHELL_QUERY));
    expect(result.current).toBe(false);
  });

  it("sorgu sonucunu ve değişimini izler", () => {
    let matches = true;
    const listeners = new Set<() => void>();
    window.matchMedia = ((q: string) => ({
      media: q,
      get matches() {
        return matches;
      },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    })) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useMediaQuery(NARROW_SHELL_QUERY));
    expect(result.current).toBe(true);
    act(() => {
      matches = false;
      listeners.forEach((fn) => fn());
    });
    expect(result.current).toBe(false);
  });
});

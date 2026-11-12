import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("./Sidebar", async () => {
  const { useSidebarHold } = await import("./sidebar-hover");
  return {
    Sidebar: ({ collapsed }: { collapsed: boolean }) => {
      const hold = useSidebarHold();
      return (
        <aside data-testid="sidebar" data-collapsed={String(collapsed)}>
          <button onClick={() => hold(true)}>ac</button>
          <button onClick={() => hold(false)}>birak</button>
        </aside>
      );
    },
  };
});
vi.mock("@/store/tabs", () => ({
  useTabsStore: (sel: (s: { tabs: never[]; activeId: null }) => unknown) => sel({ tabs: [], activeId: null }),
}));

import { ShellSidebar } from "./ShellSidebar";
import { HOVER_CLOSE_DELAY_MS, HOVER_OPEN_DELAY_MS } from "./sidebar-hover";

const dock = () => screen.getByTestId("sidebar-dock");
const isCollapsed = () => screen.getByTestId("sidebar").dataset.collapsed;
const enter = () => fireEvent.pointerEnter(dock());
const leave = () => fireEvent.pointerLeave(dock());
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const renderShell = (collapsed: boolean) =>
  render(<ShellSidebar narrow={false} collapsed={collapsed} drawerOpen={false} onCloseDrawer={() => {}} />);

describe("kenar menü hover ile geçici açılış", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it("daraltılmışken fare girince gecikmeyle açılır, çıkınca kapanır", () => {
    renderShell(true);
    enter();
    expect(isCollapsed()).toBe("true");
    tick(HOVER_OPEN_DELAY_MS + 1);
    expect(isCollapsed()).toBe("false");
    leave();
    tick(HOVER_CLOSE_DELAY_MS + 1);
    expect(isCollapsed()).toBe("true");
  });

  it("kısa geçişte (gecikmeden önce çıkış) açılmaz", () => {
    renderShell(true);
    enter();
    tick(50);
    leave();
    tick(500);
    expect(isCollapsed()).toBe("true");
  });

  it("kalıcı açıkken hover bir şey değiştirmez ve tercih yazılmaz", () => {
    renderShell(false);
    enter();
    tick(500);
    leave();
    tick(500);
    expect(isCollapsed()).toBe("false");
    expect(localStorage.getItem("sidebar.collapsed")).toBeNull();
  });

  it("hover tercih yazımını tetiklemez", () => {
    const set = vi.spyOn(Storage.prototype, "setItem");
    renderShell(true);
    enter();
    tick(500);
    expect(set).not.toHaveBeenCalled();
  });

  it("dokunmatik/kalem imleci açmaz", () => {
    renderShell(true);
    const ev = new Event("pointerover", { bubbles: true });
    Object.defineProperty(ev, "pointerType", { value: "touch" });
    act(() => void dock().dispatchEvent(ev));
    tick(500);
    expect(isCollapsed()).toBe("true");
  });

  it("bağlam menüsü açıkken fare çıksa da kapanmaz, kapanınca kapanır", () => {
    renderShell(true);
    enter();
    tick(HOVER_OPEN_DELAY_MS + 1);
    fireEvent.click(screen.getByText("ac"));
    leave();
    tick(1000);
    expect(isCollapsed()).toBe("false");
    fireEvent.click(screen.getByText("birak"));
    tick(HOVER_CLOSE_DELAY_MS + 1);
    expect(isCollapsed()).toBe("true");
  });

  it("menüye klavye odağı (focus-visible) geçici açar, odak çıkınca kapanır", () => {
    renderShell(true);
    const btn = screen.getByText("ac");
    const m = vi.spyOn(btn, "matches").mockReturnValue(true);
    fireEvent.focus(btn);
    tick(HOVER_OPEN_DELAY_MS + 1);
    expect(isCollapsed()).toBe("false");
    fireEvent.blur(btn, { relatedTarget: document.body });
    tick(HOVER_CLOSE_DELAY_MS + 1);
    expect(isCollapsed()).toBe("true");
    m.mockRestore();
  });
});

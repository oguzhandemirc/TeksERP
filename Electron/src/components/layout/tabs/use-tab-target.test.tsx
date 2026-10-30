import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readTabOpenMode, setTabOpenMode } from "./tab-open-mode";
import { useOpenTarget, useOpenTopLevel, useTabTarget } from "./use-tab-target";

/**
 * "Sekme davranışı" kişisel tercihi (2026-10-30). Varsayılan = bugünkü davranış;
 * "Aynı sekmede aç" → her tık aktif sekmede, yeni sekme yalnız Ctrl/⌘/Shift + tık ya da orta tık.
 */

const openTab = vi.fn();
const navigateActive = vi.fn();
vi.mock("@/store/tabs", () => ({
  useTabsStore: (sel: (s: { openTab: unknown; navigateActive: unknown }) => unknown) =>
    sel({ openTab, navigateActive }),
}));

function MenuItem() {
  const t = useTabTarget("/operations/orders");
  return (
    <button type="button" {...t}>
      menu
    </button>
  );
}

function InPageLink() {
  const open = useOpenTarget();
  return (
    <button type="button" onClick={(e) => open("/operations/orders/1", e)}>
      link
    </button>
  );
}

function PaletteItem() {
  const open = useOpenTopLevel();
  return (
    <button type="button" onClick={() => open("/operations/rolls")}>
      palette
    </button>
  );
}

const newTabCalls = () => openTab.mock.calls.filter((c) => c[1]?.forceNew === true);

beforeEach(() => {
  openTab.mockClear();
  navigateActive.mockClear();
  render(
    <>
      <MenuItem />
      <InPageLink />
      <PaletteItem />
    </>,
  );
});

afterEach(() => setTabOpenMode("newTab"));

describe("readTabOpenMode", () => {
  it("eksik/bilinmeyen değer → varsayılan newTab", () => {
    expect(readTabOpenMode(undefined)).toBe("newTab");
    expect(readTabOpenMode({})).toBe("newTab");
    expect(readTabOpenMode({ tabs: { openMode: "garip" as never } })).toBe("newTab");
    expect(readTabOpenMode({ tabs: { openMode: "sameTab" } })).toBe("sameTab");
  });
});

describe("tercih yok (varsayılan) — bugünkü davranış", () => {
  it("menü sol tık → openTab (odakla ya da yeni sekme)", () => {
    fireEvent.click(screen.getByText("menu"));
    expect(openTab).toHaveBeenCalledWith("/operations/orders");
    expect(navigateActive).not.toHaveBeenCalled();
  });

  it("menü sağ tık → arka planda yeni sekme", () => {
    fireEvent.contextMenu(screen.getByText("menu"));
    expect(openTab).toHaveBeenCalledWith("/operations/orders", {
      forceNew: true,
      state: undefined,
      background: true,
    });
  });

  it("palet seçimi → openTab; sayfa içi sol tık → yerinde", () => {
    fireEvent.click(screen.getByText("palette"));
    expect(openTab).toHaveBeenCalledWith("/operations/rolls");
    fireEvent.click(screen.getByText("link"));
    expect(navigateActive).toHaveBeenCalledWith("/operations/orders/1", { state: undefined });
  });
});

describe("Aynı sekmede aç", () => {
  beforeEach(() => setTabOpenMode("sameTab"));

  it("menü, palet ve sayfa içi sol tık → aktif sekmede", () => {
    fireEvent.click(screen.getByText("menu"));
    fireEvent.click(screen.getByText("palette"));
    fireEvent.click(screen.getByText("link"));
    expect(navigateActive.mock.calls.map((c) => c[0])).toEqual([
      "/operations/orders",
      "/operations/rolls",
      "/operations/orders/1",
    ]);
    expect(openTab).not.toHaveBeenCalled();
  });

  it("sağ tık yeni sekme AÇMAZ", () => {
    fireEvent.contextMenu(screen.getByText("menu"));
    expect(openTab).not.toHaveBeenCalled();
    expect(navigateActive).not.toHaveBeenCalled();
  });

  it("ctrl/⌘ + tık ve orta tık yine yeni sekme", () => {
    fireEvent.click(screen.getByText("menu"), { ctrlKey: true });
    fireEvent.click(screen.getByText("link"), { metaKey: true });
    fireEvent(screen.getByText("menu"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    const calls = newTabCalls();
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c[1].background)).toEqual([false, false, true]);
    expect(navigateActive).not.toHaveBeenCalled();
  });
});

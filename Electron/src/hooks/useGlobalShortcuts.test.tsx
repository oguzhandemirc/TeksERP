import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { ShortcutsDialog } from "@/components/layout/ShortcutsDialog";

// g-then-key gezinme: bölüm kısayolları (g s/u/e/v) ve eski `g o` birlikte çalışır; rehber aynı harfleri söyler.

const navigateActive = vi.fn();
vi.mock("@/store/tabs", () => ({
  useTabsStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ navigateActive, backActive: vi.fn() }),
}));

const { useGlobalShortcuts, GO } = await import("./useGlobalShortcuts");

const bas = (key: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

beforeEach(() => navigateActive.mockReset());

describe("useGlobalShortcuts — g ardından harf", () => {
  it.each([
    ["s", "/sales"],
    ["u", "/production"],
    ["e", "/warehouse"],
    ["v", "/shipping"],
    ["o", "/operations"],
    ["d", "/"],
    ["t", "/definitions"],
    ["r", "/reports"],
  ])("g %s → %s", (harf, yol) => {
    const { unmount } = renderHook(() => useGlobalShortcuts({ onOpenCommand: vi.fn(), onOpenHelp: vi.fn() }));
    bas("g");
    bas(harf);
    expect(navigateActive).toHaveBeenCalledWith(yol);
    unmount();
  });

  it("g'siz harf gezinmez; tanımsız harf g'yi tüketir", () => {
    const { unmount } = renderHook(() => useGlobalShortcuts({ onOpenCommand: vi.fn(), onOpenHelp: vi.fn() }));
    bas("s");
    bas("g");
    bas("x");
    bas("s");
    expect(navigateActive).not.toHaveBeenCalled();
    unmount();
  });

  it("harfler çakışmaz (her hedef tek harfte)", () => {
    expect(new Set(Object.values(GO)).size).toBe(Object.keys(GO).length);
  });
});

describe("ShortcutsDialog", () => {
  it("bölüm kısayollarını ve eski Operasyon kısayolunu listeler", () => {
    render(<ShortcutsDialog open onOpenChange={() => {}} />);
    for (const ad of ["Satış", "Üretim", "Depo", "Sevkiyat", "Operasyon (tüm bölümler)"]) {
      expect(screen.getByText(ad)).toBeTruthy();
    }
  });
});

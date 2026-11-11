import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AppPreferences } from "@/types/preferences";
import type { PreferencePatch } from "@/providers/PreferencesProvider";
import { AppearanceSettings } from "./AppearanceSettings";

// Ayarlar › Görünüm: seçim tercihe `appearance` olarak yazılır, önizleme seçimle çizilir, sıfırlama çalışır.
let prefs: AppPreferences = {};
const setPreference = vi.fn((patch: PreferencePatch) => {
  prefs = { ...prefs, ...(typeof patch === "function" ? patch(prefs) : patch) };
});
vi.mock("@/providers/PreferencesProvider", () => ({
  useOptionalPreferences: () => ({ prefs, setPreference, resetPreferences: vi.fn(), ready: true }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));

describe("AppearanceSettings", () => {
  beforeEach(() => {
    prefs = {};
    setPreference.mockClear();
  });

  it("⭐ hazır tema seçimi appearance.preset yazar; örnekler kendi data-preset kapsamında", () => {
    const { rerender } = render(<AppearanceSettings />);
    const blue = screen.getByRole("radio", { name: "Mavi" });
    expect(blue).toHaveAttribute("data-preset", "blue");
    fireEvent.click(blue);
    expect(prefs.appearance?.preset).toBe("blue");
    rerender(<AppearanceSettings />);
    expect(screen.getByRole("radio", { name: "Mavi" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("appearance-preview")).toHaveAttribute("data-preset", "blue");
  });

  it("⭐ eksen seçimleri (menü, yoğunluk) tercihe ve önizlemeye yansır", () => {
    const { rerender } = render(<AppearanceSettings />);
    fireEvent.click(within("Menü stili", "Koyu"));
    fireEvent.click(within("Liste yoğunluğu", "Rahat"));
    rerender(<AppearanceSettings />);
    expect(prefs.appearance).toMatchObject({ sidebar: "dark", density: "comfortable" });
    const preview = screen.getByTestId("appearance-preview");
    expect(preview).toHaveAttribute("data-sidebar", "dark");
    expect(preview).toHaveAttribute("data-density", "comfortable");
  });

  it("⭐ Varsayılana dön: varsayılanda pasif, değişince görünümü sıfırlar", () => {
    prefs = { appearance: { preset: "rose", radius: "small" } };
    const { rerender } = render(<AppearanceSettings />);
    fireEvent.click(screen.getByRole("button", { name: /Varsayılana dön/ }));
    rerender(<AppearanceSettings />);
    expect(prefs.appearance).toMatchObject({ preset: "violet", radius: "large" });
    expect(screen.getByRole("button", { name: /Varsayılana dön/ })).toBeDisabled();
  });
});

function within(group: string, label: string): HTMLElement {
  const g = screen.getByRole("radiogroup", { name: group });
  const btn = Array.from(g.querySelectorAll<HTMLElement>('[role="radio"]')).find((b) => b.textContent === label);
  if (!btn) throw new Error(`${group} › ${label} yok`);
  return btn;
}

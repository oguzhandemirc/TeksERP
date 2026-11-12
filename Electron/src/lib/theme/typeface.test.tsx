// Yazı tipi ekseni (kullanıcı 2026-11-12): Inter varsayılan; seçim → <html data-typeface> → index.css
// `--app-font`; aile yerel paketten (fonts.ts) gelir; eski kayıt Inter'e düşer.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_APPEARANCE, applyAppearance, resolveAppearance } from "./appearance";
import { TYPEFACES, TypefacePicker } from "@/components/layout/appearance/TypefacePicker";

const css = readFileSync(resolve(__dirname, "../../index.css"), "utf8");
const fonts = readFileSync(resolve(__dirname, "fonts.ts"), "utf8");

/** index.css'te seçeneğin `--app-font` değerindeki ilk aile adı. */
function familyOf(value: string): string | undefined {
  const m = new RegExp(`\\[data-typeface="${value}"\\]\\s*\\{\\s*--app-font:\\s*"([^"]+)"`).exec(css);
  return m?.[1];
}

describe("yazı tipi tercihi", () => {
  it("varsayılan Inter; eski (alanı olmayan) ve bozuk kayıt Inter'e düşer; geçerli seçim korunur", () => {
    expect(DEFAULT_APPEARANCE.typeface).toBe("inter");
    expect(resolveAppearance({ appearance: { preset: "blue" } }).typeface).toBe("inter");
    expect(resolveAppearance({ appearance: { typeface: "comic" as never } }).typeface).toBe("inter");
    expect(resolveAppearance({ appearance: { typeface: "source-serif" } }).typeface).toBe("source-serif");
  });

  it("uygulanınca <html data-typeface> yazılır", () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, typeface: "dm-sans" });
    expect(document.documentElement.getAttribute("data-typeface")).toBe("dm-sans");
    applyAppearance(DEFAULT_APPEARANCE);
    expect(document.documentElement.getAttribute("data-typeface")).toBe("inter");
  });

  it("her seçeneğin CSS kuralı var ve ailesi yerel paketten yükleniyor (ağ yok)", () => {
    const pkg: Record<string, string> = {
      "Inter Variable": "@fontsource-variable/inter/",
      "DM Sans": "@fontsource/dm-sans/latin-ext-",
      "Nunito Sans": "@fontsource/nunito-sans/latin-ext-",
      "Plus Jakarta Sans": "@fontsource/plus-jakarta-sans/",
      "Source Serif 4": "@fontsource/source-serif-4/latin-ext-",
    };
    for (const { value } of TYPEFACES) {
      const fam = familyOf(value);
      expect(fam, value).toBeTruthy();
      expect(fonts, `${value} → ${fam}`).toContain(pkg[fam!]);
    }
    expect(css).toMatch(/--font-sans:\s*var\(--app-font\)/);
    expect(fonts).not.toMatch(/https?:\/\//);
    // Türkçe gövde ağırlıkları (latin-ext) eksiksiz.
    for (const w of [400, 500, 600, 700]) expect(fonts).toContain(`/latin-ext-${w}.css`);
  });

  it("seçici her satırı kendi yazı tipi kapsamında çizer; tık seçimi bildirir", async () => {
    const onChange = vi.fn();
    render(<TypefacePicker value="inter" onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("data-typeface"))).toEqual(TYPEFACES.map((t) => t.value));
    expect(screen.getByRole("radio", { name: /Inter/ })).toHaveAttribute("aria-checked", "true");
    await userEvent.setup().click(screen.getByRole("radio", { name: /Nunito Sans/ }));
    expect(onChange).toHaveBeenCalledWith("nunito-sans");
  });
});

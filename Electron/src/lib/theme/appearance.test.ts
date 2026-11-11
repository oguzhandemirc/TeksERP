// T4 kişiselleştirme — tercih doğrulama, eski alan göçü, kök öznitelik yazımı, özel renk kontrastı.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  PRESET_KEYS,
  appearancePatch,
  applyAppearance,
  customColorVars,
  resolveAppearance,
} from "./appearance";
import { contrastRatio, parseHslChannels } from "./color";

const CSS = readFileSync(resolve(__dirname, "../../index.css"), "utf8");

describe("resolveAppearance", () => {
  it("⭐ boş blob → kullanıcı kararı varsayılanları (mor, açık menü, lavanta, geniş köşe, sıkı)", () => {
    expect(resolveAppearance({})).toEqual(DEFAULT_APPEARANCE);
    expect(DEFAULT_APPEARANCE).toMatchObject({ preset: "violet", sidebar: "light", surface: "lavender", radius: "large", density: "compact", font: "normal", tiles: "color" });
  });

  it("⭐ bilinmeyen/bozuk değer alan alan varsayılana düşer, geçerliler korunur", () => {
    const a = resolveAppearance({ appearance: { preset: "neon" as never, sidebar: "dark", radius: 7 as never, customColor: "kırmızı" } });
    expect(a.preset).toBe("violet");
    expect(a.sidebar).toBe("dark");
    expect(a.radius).toBe("large");
    expect(a.customColor).toBe(DEFAULT_APPEARANCE.customColor);
  });

  it("⭐ göç: seçilmiş eski vurgu rengi korunur (hazır eşleşme ya da özel renk)", () => {
    expect(resolveAppearance({ accent: "217 91% 60%" }).preset).toBe("blue");
    const custom = resolveAppearance({ accent: "100 50% 40%" });
    expect(custom.preset).toBe("custom");
    expect(custom.customColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("⭐ göç: eski yoğunluktan yalnız 'compact' taşınır ('comfortable' eski varsayılandı)", () => {
    expect(resolveAppearance({ density: "compact" }).density).toBe("compact");
    expect(resolveAppearance({ density: "comfortable" }).density).toBe("compact");
  });

  it("yeni alan varsa eski alanlar okunmaz", () => {
    expect(resolveAppearance({ accent: "217 91% 60%", appearance: { preset: "rose" } }).preset).toBe("rose");
  });

  it("appearancePatch: tam görünüm yazar, eski accent boşalır", () => {
    const p = appearancePatch({ accent: "217 91% 60%" }, { density: "comfortable" });
    expect(p.accent).toBeNull();
    expect(p.appearance).toMatchObject({ preset: "blue", density: "comfortable", radius: "large" });
  });
});

describe("applyAppearance", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
  });

  it("⭐ her eksen <html data-*> olarak yazılır; eski satır içi accent değişkenleri temizlenir", () => {
    const root = document.documentElement;
    root.style.setProperty("--primary", "1 2% 3%");
    applyAppearance({ ...DEFAULT_APPEARANCE, preset: "teal", sidebar: "brand", surface: "white", radius: "small", density: "comfortable", font: "large", tiles: "mono" });
    expect(root.dataset).toMatchObject({ preset: "teal", sidebar: "brand", surface: "white", radius: "small", density: "comfortable", font: "large", tiles: "mono" });
    expect(root.style.getPropertyValue("--primary")).toBe("");
    expect(root.style.getPropertyValue("--custom-h")).toBe("");
  });

  it("⭐ özel renk: --custom-* yazılır, hazır temaya dönünce silinir", () => {
    const root = document.documentElement;
    applyAppearance({ ...DEFAULT_APPEARANCE, preset: "custom", customColor: "#ffd400" });
    expect(root.dataset.preset).toBe("custom");
    expect(root.style.getPropertyValue("--custom-h")).toBe("50");
    applyAppearance(DEFAULT_APPEARANCE);
    expect(root.style.getPropertyValue("--custom-h")).toBe("");
  });

  it("verilen elemana yazar (önizleme kutusu)", () => {
    const el = document.createElement("div");
    applyAppearance({ ...DEFAULT_APPEARANCE, preset: "rose" }, el);
    expect(el.dataset.preset).toBe("rose");
  });
});

describe("özel renk kontrastı", () => {
  it.each(["#ffd400", "#ffffff", "#1a1a2e", "#6d4ee6", "#00c2a8", "#ff7a00"])("⭐ %s üstünde yazı rengi daha okunur olanı", (hex) => {
    const vars = customColorVars(hex)!;
    const bg = parseHslChannels(`${vars["--custom-h"]} ${vars["--custom-s"]} ${vars["--custom-l"]}`)!;
    const fg = parseHslChannels(vars["--custom-fg"]!)!;
    const other = fg.l > 50 ? { h: 240, s: 24, l: 10 } : { h: 0, s: 0, l: 100 };
    expect(contrastRatio(bg, fg)).toBeGreaterThanOrEqual(contrastRatio(bg, other));
  });
  it("açık sarıda koyu, koyu laciverde beyaz yazı", () => {
    expect(customColorVars("#ffd400")!["--custom-fg"]).not.toBe("0 0% 100%");
    expect(customColorVars("#1a1a2e")!["--custom-fg"]).toBe("0 0% 100%");
  });
  it("geçersiz hex → null", () => {
    expect(customColorVars("abc-")).toBeNull();
  });
});

describe("index.css — her seçeneğin seçicisi var (önizleme kökü miras almasın)", () => {
  const values: Record<string, readonly string[]> = {
    preset: [...PRESET_KEYS, "custom"],
    sidebar: ["light", "dark", "brand"],
    surface: ["lavender", "neutral", "white"],
    radius: ["small", "medium", "large"],
    density: ["compact", "comfortable"],
    font: ["small", "large"],
  };
  it.each(Object.entries(values))("⭐ data-%s", (axis, list) => {
    const missing = list.filter((v) => !CSS.includes(`[data-${axis}="${v}"]`));
    expect(missing).toEqual([]);
  });
});

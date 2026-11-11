// =============================================================================
// Bekçi: görünüm zinciri — seçenek → <html data-*> → index.css seçicisi → yüzeye ulaşan değişken
// =============================================================================
// Kullanıcı 2026-11-12: "tema renkleri / yoğunluk / zemin çalışmıyor". Kök neden: `@theme` (inline
// değil) `--color-primary`ı :root'ta bir kez çözüyordu; iç kapsamdaki data-preset (renk örnekleri,
// önizleme) kökün rengini gösteriyordu. Zincirin her halkası burada ölçülür.
// =============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { appearanceAttributes, applyAppearance, DEFAULT_APPEARANCE, type Appearance } from "@/lib/theme/appearance";
import {
  DENSITIES,
  FONTS,
  PRESETS,
  RADII,
  SIDEBARS,
  SURFACES,
  TILES,
} from "@/components/layout/appearance/appearance-options";

const raw = readFileSync(resolve(process.cwd(), "src/index.css"), "utf-8");
const css = postcss.parse(raw);

const scopes: string[] = [];
css.walkAtRules("scope", (a) => {
  scopes.push(a.params);
});

/** Değerin kendi bloğu: `[data-x="v"]` (ya da `html[data-x="v"]`) bildirimleri. */
function declsFor(attr: string, value: string): Record<string, string> {
  const out: Record<string, string> = {};
  const want = [`[${attr}="${value}"]`, `html[${attr}="${value}"]`];
  css.walkRules((r) => {
    if (r.selectors.some((s) => want.includes(s.trim()))) r.walkDecls((d) => {
        out[d.prop] = d.value;
      });
  });
  return out;
}

const AXES: { key: keyof Appearance; values: readonly string[]; vars: string[] }[] = [
  { key: "preset", values: PRESETS.map((o) => o.value), vars: ["--primary", "--ring"] },
  { key: "sidebar", values: SIDEBARS.map((o) => o.value), vars: ["--sidebar"] },
  { key: "surface", values: SURFACES.map((o) => o.value), vars: ["--background"] },
  { key: "radius", values: RADII.map((o) => o.value), vars: ["--radius-card", "--radius-control"] },
  { key: "density", values: DENSITIES.map((o) => o.value), vars: ["--cell-py", "--head-h", "--cell-wrap"] },
];

describe("görünüm zinciri", () => {
  it("@theme inline: yardımcılar değişkeni kullanıldığı elemanda çözer", () => {
    expect(raw).toMatch(/@theme inline\s*\{/);
    expect(raw).toMatch(/--color-primary:\s*hsl\(var\(--primary\)\)/);
    expect(raw).toMatch(/--color-background:\s*hsl\(var\(--background\)\)/);
  });

  it("applyAppearance her ekseni <html> özniteliğine yazar", () => {
    const a: Appearance = { ...DEFAULT_APPEARANCE, preset: "rose", surface: "white", density: "comfortable", sidebar: "brand" };
    applyAppearance(a);
    for (const [k, v] of Object.entries(appearanceAttributes(a))) expect(document.documentElement.getAttribute(k)).toBe(v);
  });

  for (const axis of AXES) {
    it(`${axis.key}: her seçeneğin kendi seçicisi var ve değişkenleri yazıyor`, () => {
      const seen = new Map<string, string>();
      for (const v of axis.values) {
        const d = declsFor(`data-${axis.key}`, v);
        for (const name of axis.vars) {
          expect(d[name], `[data-${axis.key}="${v}"] ${name}`).toBeTruthy();
        }
        seen.set(v, axis.vars.map((n) => d[n]).join("|"));
      }
      // Seçenekler birbirinden FARKLI değer yazmalı (aynı değer = "tıkladım, değişmedi").
      expect(new Set(seen.values()).size).toBe(axis.values.length);
    });
  }

  it("yazı boyutu: küçük/büyük kök font ölçeğini değiştirir", () => {
    for (const v of FONTS.map((o) => o.value).filter((v) => v !== "normal")) {
      expect(declsFor("data-font", v)["font-size"]).toBeTruthy();
    }
  });

  it("simge kareleri: tek renk kapsamı tanımlı", () => {
    expect(TILES.map((o) => o.value)).toContain("mono");
    expect(scopes.some((p) => p.includes('[data-tiles="mono"]'))).toBe(true);
  });

  it("koyu kipte her zemin ayrı değer yazar", () => {
    const dark = SURFACES.map((o) => {
      let bg = "";
      css.walkRules((r) => {
        if (r.selectors.some((s) => s.trim() === `.dark[data-surface="${o.value}"]`)) r.walkDecls("--background", (d) => {
            bg = d.value;
          });
      });
      return bg;
    });
    expect(dark.every(Boolean)).toBe(true);
    expect(new Set(dark).size).toBe(SURFACES.length);
  });

  it("tablo hücresi yoğunluk değişkenlerini okur", () => {
    const table = readFileSync(resolve(process.cwd(), "src/components/ui/table.tsx"), "utf-8");
    expect(table).toContain("py-[var(--cell-py)]");
    expect(table).toContain("var(--cell-wrap");
    expect(table).toContain("h-[var(--head-h)]");
  });
});

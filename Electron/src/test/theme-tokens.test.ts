// =============================================================================
// Bekçi: tema belirteçleri — WCAG AA kontrastı (açık/koyu, her hazır tema, pastel haplar)
// =============================================================================
// index.css postcss ile AYRIŞTIRILIR; kökteki (:root / .dark) ve hazır tema bloklarındaki HSL kanalları
// okunur, yazı/zemin çiftlerinin kontrastı ölçülür. Metin ≥ 4.5, simge (simge karesi) ≥ 3.
// =============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { contrastRatio, parseHslChannels, type Hsl } from "@/lib/theme/color";

const css = postcss.parse(readFileSync(resolve(process.cwd(), "src/index.css"), "utf-8"));

/** Seçicinin (ilk eşleşen kuralın) bildirimleri. */
function block(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  css.walkRules((r) => {
    if (r.selectors.includes(selector)) r.walkDecls((d) => (out[d.prop] = d.value));
  });
  return out;
}

const root = block(":root");
const dark = { ...root, ...block(".dark") };
const PRESETS = ["violet", "blue", "teal", "green", "orange", "rose", "graphite"] as const;

function resolveVar(vars: Record<string, string>, name: string): Hsl {
  let v = vars[name];
  for (let i = 0; i < 5 && v?.startsWith("var("); i++) v = vars[v.slice(4, -1).trim()];
  const c = v ? parseHslChannels(v) : null;
  if (!c) throw new Error(`${name} çözülemedi: ${vars[name]}`);
  return c;
}

const TEXT_PAIRS: [string, string][] = [
  ["--foreground", "--background"],
  ["--card-foreground", "--card"],
  ["--popover-foreground", "--popover"],
  ["--muted-foreground", "--card"],
  ["--muted-foreground", "--background"],
  ["--muted-foreground", "--muted"],
  ["--secondary-foreground", "--secondary"],
  ["--accent-foreground", "--accent"],
  ["--primary-foreground", "--primary"],
  ["--primary-foreground", "--primary-2"],
  ["--primary-soft-foreground", "--primary-soft"],
  ["--destructive-foreground", "--destructive"],
  ["--success-foreground", "--success"],
  ["--info-foreground", "--info"],
  ["--warning-foreground", "--warning"],
  ["--success-soft-foreground", "--success-soft"],
  ["--warning-soft-foreground", "--warning-soft"],
  ["--info-soft-foreground", "--info-soft"],
  ["--destructive-soft-foreground", "--destructive-soft"],
  ["--sidebar-foreground", "--sidebar"],
  ["--sidebar-muted", "--sidebar"],
];
const TILES = ["violet", "blue", "sky", "teal", "green", "amber", "orange", "rose"];

function failures(vars: Record<string, string>, pairs: [string, string][], min: number): string[] {
  return pairs
    .map(([fg, bg]) => [fg, bg, contrastRatio(resolveVar(vars, fg), resolveVar(vars, bg))] as const)
    .filter(([, , r]) => r < min)
    .map(([fg, bg, r]) => `${fg} / ${bg} = ${r.toFixed(2)}`);
}

describe("tema belirteçleri — WCAG AA", () => {
  it.each([
    ["açık", root],
    ["koyu", dark],
  ])("%s tema metin çiftleri ≥ 4.5", (_ad, vars) => {
    expect(failures(vars, TEXT_PAIRS, 4.5)).toEqual([]);
  });

  it.each([
    ["açık", root],
    ["koyu", dark],
  ])("%s tema simge kareleri ≥ 3", (_ad, vars) => {
    expect(failures(vars, TILES.map((t) => [`--tile-${t}`, `--tile-${t}-bg`]), 3)).toEqual([]);
  });

  it.each(PRESETS)("hazır tema %s: birincil + seçim çiftleri açık/koyu ≥ 4.5", (p) => {
    const pairs: [string, string][] = [
      ["--primary-foreground", "--primary"],
      ["--primary-foreground", "--primary-2"],
      ["--primary-soft-foreground", "--primary-soft"],
    ];
    const light = { ...root, ...block(`[data-preset="${p}"]`) };
    const darkP = { ...dark, ...block(`[data-preset="${p}"]`), ...block(`.dark[data-preset="${p}"]`) };
    expect([...failures(light, pairs, 4.5), ...failures(darkP, pairs, 4.5)]).toEqual([]);
  });

  it("menü stilleri (koyu) okunur", () => {
    const vars = { ...root, ...block('[data-sidebar="dark"]') };
    expect(failures(vars, [["--sidebar-foreground", "--sidebar"], ["--sidebar-muted", "--sidebar"]], 4.5)).toEqual([]);
  });

  it("ölçer çalışıyor (sonda): beyaz üstünde açık gri metin düşer", () => {
    expect(failures({ "--a": "0 0% 80%", "--b": "0 0% 100%" }, [["--a", "--b"]], 4.5)).toHaveLength(1);
  });
});

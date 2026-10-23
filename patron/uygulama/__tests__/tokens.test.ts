// Token bekçisi: ham 6 haneli hex YALNIZ `src/ui/tokens.ts`te (ekranlar `useTokens()`tan okur); ışık/koyu setleri
// aynı şekilde; okunurluk çiftleri WCAG eşiğinde; tasarım belgesindeki her hex kodda var.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { dark, light, type Tokens } from "../src/ui/tokens";

const ROOT = join(__dirname, "..");
const HEX = /#[0-9A-Fa-f]{6}\b/g;
const TOKENS_FILE = "src/ui/tokens.ts";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(tsx?|jsx?)$/.test(n) ? [p] : [];
  });
}

export function hexOffenders(files: readonly string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    const rel = relative(ROOT, f).split("\\").join("/");
    if (rel === TOKENS_FILE) continue;
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (line.match(HEX)) out.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  return out;
}

describe("§1 ham hex yalnız tokens.ts'te", () => {
  it("src/ ve app/ altında tokens.ts dışında 6 haneli hex yok", () => {
    const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "app"))];
    expect(files.length).toBeGreaterThan(20);
    expect(hexOffenders(files)).toEqual([]);
  });
});

function leaves(o: unknown, path = ""): [string, unknown][] {
  if (o && typeof o === "object" && !Array.isArray(o)) return Object.entries(o).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [[path, o]];
}

describe("§2 ışık/koyu setleri", () => {
  it("aynı anahtarlar; renk alanları 6 haneli hex", () => {
    const l = leaves(light).filter(([k]) => !k.includes("Shadow")).map(([k]) => k).sort();
    const d = leaves(dark).filter(([k]) => !k.includes("Shadow")).map(([k]) => k).sort();
    expect(d).toEqual(l);
    for (const [k, v] of leaves(light).concat(leaves(dark))) {
      if (k === "scheme" || k.endsWith(".icon") || k.includes("Shadow")) continue;
      expect([k, v]).toEqual([k, expect.stringMatching(/^#[0-9A-F]{6}$/)]);
    }
  });
});

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

describe("§3 okunurluk (metin ≥ 4.5:1)", () => {
  it.each([["light", light], ["dark", dark]] as const)("%s", (_n, t: Tokens) => {
    for (const fg of [t.text, t.textSecondary, t.textMuted]) {
      expect(contrast(fg, t.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(fg, t.surface)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(t.onTint, t.tint)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.tint, t.surface)).toBeGreaterThanOrEqual(4.5);
    for (const s of Object.values(t.status)) expect(contrast(s.text, s.bg)).toBeGreaterThanOrEqual(4.5);
    for (const d of Object.values(t.domain)) expect(contrast(d.fg, t.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.role.yonetici.fg, t.role.yonetici.bg)).toBeGreaterThanOrEqual(4.5);
    for (const fg of [t.onNavy.text, t.onNavy.textSecondary, t.onNavy.textMuted]) expect(contrast(fg, t.navy)).toBeGreaterThanOrEqual(4.5);
    for (const st of Object.values(t.station)) expect(contrast(st.fg, t.surface)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("§4 tasarım belgesi ↔ kod", () => {
  // Metin araması değil DEĞER kümesi: yalnız tokens.ts yorumunda geçen hex belgeyi karşılamaz.
  it("docs/design/PATRON-TASARIM-DILI.md içindeki her hex light/dark token değeridir", () => {
    const doc = readFileSync(join(ROOT, "../../docs/design/PATRON-TASARIM-DILI.md"), "utf8");
    const values = new Set(leaves(light).concat(leaves(dark)).map(([, v]) => String(v).toUpperCase()));
    const hexes = [...new Set(doc.match(HEX) ?? [])];
    expect(hexes.length).toBeGreaterThan(30);
    expect(hexes.filter((h) => !values.has(h.toUpperCase()))).toEqual([]);
  });
});

// Perf-5 istemci bekçisi (perf-fix-3): pasif sekme yoklamaz (E-02) · renderer minifiye (E-01).
// Pasif sekmeler mount kalır; TanStack'in `refetchIntervalInBackground:false`ı gizli SEKMEYİ
// arka plan saymaz — her `refetchInterval:` ya `useIsTabActive()` değişkenine bağlı ya da
// bir üst satırda `// tab-aktif-muaf: <neden>` beyanlı olmalı.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Kapısız yoklayıcı satırlarını döndürür (`dosya:satır`). Saf — negatif sonda bunu çağırır. */
export function kapisizYoklayicilar(file: string, src: string): string[] {
  const names = [...src.matchAll(/const\s+(\w+)\s*=\s*useIsTabActive\(\)/g)].map((m) => m[1]);
  const lines = src.split("\n");
  const bad: string[] = [];
  lines.forEach((line, i) => {
    if (!/\brefetchInterval\s*:/.test(line)) return;
    if (/tab-aktif-muaf:\s*\S/.test(lines[i - 1] ?? "")) return;
    if (names.some((n) => new RegExp(`\\b${n}\\b`).test(line))) return;
    bad.push(`${file}:${i + 1}`);
  });
  return bad;
}

describe("perf-istemci — pasif sekme yoklamaz (E-02)", () => {
  it("her refetchInterval useIsTabActive'e bağlı ya da muaf beyanlı", () => {
    const bad = walk(SRC).flatMap((f) => kapisizYoklayicilar(relative(SRC, f), readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });

  it("negatif sonda: kapısız ve gerekçesiz muaf yoklayıcı yakalanır", () => {
    expect(kapisizYoklayicilar("x.ts", "useQuery({ refetchInterval: 5_000 })")).toEqual(["x.ts:1"]);
    expect(kapisizYoklayicilar("x.ts", "// tab-aktif-muaf:\nuseQuery({ refetchInterval: 5_000 })")).toEqual(["x.ts:2"]);
    expect(kapisizYoklayicilar("x.ts", "const a = useIsTabActive();\nq({ refetchInterval: 5_000 })")).toEqual(["x.ts:2"]);
    expect(kapisizYoklayicilar("x.ts", "const a = useIsTabActive();\nq({ refetchInterval: a ? 5_000 : false })")).toEqual([]);
  });
});

describe("perf-istemci — renderer minifiye (E-01)", () => {
  it("electron.vite.config renderer bloğu minify açık", () => {
    const cfg = readFileSync(resolve(SRC, "../electron.vite.config.ts"), "utf8");
    const renderer = cfg.slice(cfg.indexOf("renderer:"));
    expect(renderer).toMatch(/build:\s*\{[^}]*minify:\s*"esbuild"/);
  });
});

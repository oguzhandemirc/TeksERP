// UYGULAMA YALITIMI — bayi paketi (genel dinleyici, internete açık) satıcı arayüzünün kodunu TAŞIMAZ:
// src/bayi/main.tsx'ten başlayan içe aktarma ağacı src/portal/ altına hiç girmez (ağır yaptırım,
// kök parolası, kullanıcı yönetimi ekranları bayi derlemesine sızmaz); satıcı ağacı da bayiye girmez.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(c) && /\.(ts|tsx)$/.test(c)) return c;
  }
  return null;
}

export function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    // `import x from "…"` · `export … from "…"` · yan etkili `import "…"` · dinamik `import("…")`
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const next = resolveImport(file, m[1] ?? m[2] ?? m[3]!);
      if (next) stack.push(next);
    }
  }
  return seen;
}

const rel = (files: Set<string>) => [...files].map((f) => path.relative(SRC, f));

describe("bayi ve satıcı derlemeleri birbirinin kodunu taşımaz", () => {
  const bayi = rel(importGraph(path.join(SRC, "bayi/main.tsx")));
  const portal = rel(importGraph(path.join(SRC, "portal/main.tsx")));

  it("ağaçlar gerçekten okunuyor", () => {
    expect(bayi).toContain(path.join("bayi", "routes.tsx"));
    expect(bayi).toContain(path.join("shared", "forms.tsx"));
    expect(portal).toContain(path.join("portal", "installation", "SanctionPanel.tsx"));
  });

  it("bayi ağacı src/portal altına girmez", () => {
    expect(bayi.filter((f) => f.startsWith(`portal${path.sep}`))).toEqual([]);
  });

  it("satıcı ağacı src/bayi altına girmez", () => {
    expect(portal.filter((f) => f.startsWith(`bayi${path.sep}`))).toEqual([]);
  });

  it("ortak katman hiçbir uygulamaya bağımlı değil", () => {
    const shared = rel(importGraph(path.join(SRC, "shared/AppRoot.tsx")));
    expect(shared.filter((f) => !f.startsWith(`shared${path.sep}`))).toEqual([]);
  });
});

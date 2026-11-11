// =============================================================================
// BEKÇİ — rozet/etiket/durum hapı köşesi TEK belirteçten (kullanıcı 2026-11-12)
// =============================================================================
// "Etiketlerin bazısının köşesi kıvrık bazısı kare" → hepsi köşe tercihine (az/orta/geniş) bağlı
// `rounded-badge` (`--radius-badge` ← `--badge-radius`, index.css `[data-radius]`) kullanır.
// Rozet benzeri sınıf = küçük yazı + yatay/dikey ince dolgu + zemin/kenarlık + köşe. Böyle bir sınıfta
// sabit `rounded` / `rounded-full|sm|md|lg…` kırmızıdır: `<Badge>` kullan ya da `rounded-badge` yaz.
// =============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SRC = resolve(__dirname, "..");

/** Devralınan ihlaller — başka oturumun alanında (kabuk); dönüştükçe listeden DÜŞER. */
const EXEMPT = new Set([
  "components/layout/topbar-parts.tsx",
  "components/layout/ChannelBadge.tsx",
  "components/layout/ShortcutsDialog.tsx",
  "components/layout/SupportSessionBadge.tsx",
]);

const FIXED_RADIUS = /^rounded(-(full|none|sm|md|lg|xl|2xl|3xl|\[[^\]]+\]))?$/;

/** Sınıf dizisi rozet benzeriyse sabit köşe jetonunu döner, değilse null. */
function fixedBadgeRadius(cls: string): string | null {
  const toks = cls.split(/\s+/).filter(Boolean);
  const radius = toks.find((t) => FIXED_RADIUS.test(t));
  if (!radius) return null;
  const py = toks.some((t) => /^py-(0|0\.5|px|\[[12]px\])$/.test(t));
  const px = toks.some((t) => /^px-(1|1\.5|2|2\.5|3)$/.test(t));
  const small = toks.some((t) => /^text-(xs|\[(9|10|11)px\])$/.test(t));
  const surface = toks.some((t) => t.startsWith("bg-") || t === "border");
  return py && px && small && surface ? radius : null;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

function violations(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {
      const hit = fixedBadgeRadius(m[1] ?? m[2] ?? "");
      if (!hit) continue;
      const rel = relative(SRC, file);
      found.set(rel, [...(found.get(rel) ?? []), hit]);
    }
  }
  return found;
}

describe("rozet köşesi tek belirteçten", () => {
  it("⭐ yeni sabit köşeli rozet yok (Badge ya da rounded-badge kullan)", () => {
    const fresh = [...violations()].filter(([f]) => !EXEMPT.has(f)).map(([f, r]) => `${f}: ${r.join(", ")}`);
    expect(fresh).toEqual([]);
  });

  it("muaf listesi bayat değil (dönüşen dosya listeden düşer)", () => {
    const v = violations();
    expect([...EXEMPT].filter((f) => !v.has(f))).toEqual([]);
  });

  it("Badge tabanı ve köşe tercihinin üç değeri belirtece bağlı", () => {
    expect(readFileSync(join(SRC, "components/ui/badge.tsx"), "utf8")).toContain("rounded-badge");
    const css = readFileSync(join(SRC, "index.css"), "utf8");
    expect(css).toMatch(/--radius-badge:\s*var\(--badge-radius\)/);
    for (const r of ["small", "medium", "large"]) {
      expect(css, r).toMatch(new RegExp(`\\[data-radius="${r}"\\]\\s*\\{[^}]*--badge-radius:`));
    }
  });

  it("ölçer rozeti tanır (sonda): hap/etiket ihlal; kart, düğme, belirteçli rozet değil", () => {
    expect(fixedBadgeRadius("rounded-full bg-muted px-2 py-0.5 text-xs")).toBe("rounded-full");
    expect(fixedBadgeRadius("inline-flex rounded border px-1.5 py-px text-[10px]")).toBe("rounded");
    expect(fixedBadgeRadius("rounded-badge bg-muted px-2 py-0.5 text-xs")).toBeNull();
    expect(fixedBadgeRadius("rounded-xl border bg-card p-4 text-sm")).toBeNull();
    expect(fixedBadgeRadius("h-8 rounded-md px-3 text-xs")).toBeNull();
  });
});

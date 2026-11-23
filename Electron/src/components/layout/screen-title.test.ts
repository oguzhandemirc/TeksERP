import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findCommandEntry } from "./command-entries";
import { screenTitle } from "./screen-title";

/**
 * O34 BEKÇİSİ — menü adı ↔ sayfa başlığı TEK KAYNAK.
 *
 * Denetim (2026-11-23) on ekranda menüde "Etiket Tasarımı" yazıp sayfada başka başlık çizildiğini buldu: başlık
 * sayfa dosyasında literal, menü adı karoda yaşıyordu. Kural: menüde girişi olan ekranın sayfa başlığı
 * `screenTitle(<kendi adresi>)` ile katalogdan okunur ya da (geçiş için) katalog adıyla BİREBİR aynı literaldir.
 * `content-routes.tsx` METİN olarak okunur (import edilmez; tüm sayfa ağacını ayağa kaldırmamak için).
 * NEGATİF SONDA (2026-11-23): Kartela başlığı `title="Kartela"` yapıldı → ⭐ ❌ ("Kartela" ≠ "Kartela Takibi");
 * `screenTitle("/operations/rolls")` yapıldı → ⭐ ❌ (başka ekranın adı). İkisi de geri alındı.
 */

const SRC = resolve(__dirname, "../..");
const ROUTES_SRC = readFileSync(resolve(SRC, "routes/content-routes.tsx"), "utf8");

/** Bilinçli ayrışma — gerekçeli; satırı ihlal üretmeyen giriş ölü sayılır (kırmızı). */
const AYRISMA_MUAF: Record<string, string> = {};

const WRAPPERS = new Set(["ProtectedRoute", "Navigate", "Suspense", "RegimeRoute", "ModuleRoute"]);

/** `import { X } from "@/pages/..."` → bileşen adı → dosya yolu. */
function importMap(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of ROUTES_SRC.matchAll(/import\s*\{([^}]+)\}\s*from\s*"@\/([^"]+)"/g)) {
    for (const name of m[1]!.split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!).filter(Boolean)) {
      out.set(name, m[2]!);
    }
  }
  return out;
}

/** Statik route → çizdiği ilk sayfa bileşeni. */
function routeComponents(): Array<{ path: string; component: string }> {
  const chunks = ROUTES_SRC.split(/path:\s*"/).slice(1);
  const out: Array<{ path: string; component: string }> = [];
  for (const chunk of chunks) {
    const path = chunk.slice(0, chunk.indexOf('"'));
    if (path.includes(":") || path === "*") continue;
    const body = chunk.slice(0, chunk.search(/\n {2}\},?\n|\n {2}\{ path/) + 1 || undefined);
    const comp = [...body.matchAll(/<([A-Z]\w*)/g)].map((m) => m[1]!).find((n) => !WRAPPERS.has(n));
    if (comp) out.push({ path: `/${path.replace(/^\//, "")}`, component: comp });
  }
  return out;
}

function fileOf(mod: string): string | null {
  for (const ext of [".tsx", ".ts"]) {
    const p = resolve(SRC, mod + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

type Title = { kind: "literal"; value: string } | { kind: "screen"; path: string };

/** Sayfa dosyasındaki başlık taşıyan iskeletlerin (`PageHeader` · `CrudPage<T>` · `ReportPageLayout`) `title`ı. */
function titlesIn(src: string): Title[] {
  const out: Title[] = [];
  for (const m of src.matchAll(/<(?:PageHeader|CrudPage|ReportPageLayout)(?:<[^>]+>)?\s([\s\S]*?)(?:\/>|>\s*\n)/g)) {
    const attrs = m[1]!;
    const lit = /\btitle="([^"]*)"/.exec(attrs);
    if (lit) out.push({ kind: "literal", value: lit[1]! });
    const scr = /\btitle=\{screenTitle\("([^"]+)"\)\}/.exec(attrs);
    if (scr) out.push({ kind: "screen", path: scr[1]! });
  }
  return out;
}

function measure() {
  const imports = importMap();
  const mismatches: string[] = [];
  let checked = 0;
  for (const { path, component } of routeComponents()) {
    const entry = findCommandEntry(path);
    if (!entry || entry.deep) continue;
    const mod = imports.get(component);
    const file = mod ? fileOf(mod) : null;
    if (!file) continue;
    const titles = titlesIn(readFileSync(file, "utf8"));
    // Başlığı alt bileşende ya da ifadeyle (TERIM…, titleWhen) çizen sayfa ölçülmez; zemin sayacı körlüğü yakalar.
    if (titles.length === 0) continue;
    checked++;
    const expected = screenTitle(path);
    for (const t of titles) {
      if (t.kind === "screen" && t.path !== path) mismatches.push(`${path}: screenTitle("${t.path}") başka ekranın adı`);
      if (t.kind === "literal" && t.value !== expected) mismatches.push(`${path}: sayfa "${t.value}" ≠ menü "${expected}"`);
    }
  }
  return { mismatches, checked };
}

describe("O34 — menü adı ↔ sayfa başlığı", () => {
  const { mismatches, checked } = measure();

  it("körlük zemini: yeterli sayıda sayfa başlığı ölçüldü", () => {
    expect(checked).toBeGreaterThanOrEqual(60);
  });

  it("⭐ menüde girişi olan her sayfanın başlığı menü adıyla aynı (screenTitle ya da birebir literal)", () => {
    const open = mismatches.filter((m) => !Object.keys(AYRISMA_MUAF).some((k) => m.startsWith(`${k}:`)));
    expect(open, `ayrışan başlık(lar):\n${open.join("\n")}`).toEqual([]);
  });

  it("muaf listesi bayat değil", () => {
    const dead = Object.keys(AYRISMA_MUAF).filter((k) => !mismatches.some((m) => m.startsWith(`${k}:`)));
    expect(dead).toEqual([]);
  });

  it("screenTitle katalog adını döner (sekme adıyla aynı kaynak)", () => {
    expect(screenTitle("/definitions/cariler")).toBe("Cariler");
  });
});

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
 * `TERIM…`/sabit gibi başka ifade ölçülemez sayılır ve KIRMIZIdır; başlığı hiç taşımayan sayfa gerekçeli muaftır.
 * `content-routes.tsx` METİN olarak okunur (import edilmez; tüm sayfa ağacını ayağa kaldırmamak için).
 * NEGATİF SONDA (2026-11-23): Kartela başlığı `title="Kartela"` yapıldı → ⭐ ❌ ("Kartela" ≠ "Kartela Takibi");
 * `screenTitle("/operations/rolls")` yapıldı → ⭐ ❌ (başka ekranın adı). İkisi de geri alındı.
 * NEGATİF SONDA (baslik-35): Etkinlik Günlüğü `title={TERIM_AD.etkinlikGunlugu}`a döndürüldü → ⭐ ❌ (ifade);
 * Baskı & Cihazlar route'u `title="Baskı"` yapıldı → ⭐ ❌. İkisi de geri alındı.
 */

const SRC = resolve(__dirname, "../..");
const ROUTES_SRC = readFileSync(resolve(SRC, "routes/content-routes.tsx"), "utf8");

/** Bilinçli ayrışma — gerekçeli; satırı ihlal üretmeyen giriş ölü sayılır (kırmızı). */
const AYRISMA_MUAF: Record<string, string> = {};

/** Başlığı sayfa dosyasında taşımayan ekranlar — gerekçeli; ölçülebilir hale gelen giriş ölü sayılır (kırmızı). */
const OLCUM_DISI: Record<string, string> = {
  // Rapor v2 kararı: başlık sunucu zarfından (`data.baslik ?? entry.baslik`), soru cümlesi biçiminde olabilir.
  "/cost/yarn-need": "ReportV2Frame — başlık rapor zarfından",
  "/reports/production/makine-duruslari": "ReportV2Frame — başlık rapor zarfından (\"Makineler neden durdu?\")",
  "/reports/finance/masraf-ozeti": "ReportV2Frame — başlık rapor zarfından",
  "/reports/maliyet/dokuma-verimlilik": "ReportV2Frame — başlık rapor zarfından (\"Dokuma maliyeti standarttan saptı mı?\")",
};

const WRAPPERS = new Set(["ProtectedRoute", "Navigate", "Suspense", "RegimeRoute", "ModuleRoute"]);
const SKELETON = /<(?:PageHeader|CrudPage|ReportPageLayout|ReportHubGrid|SettingsSurfacePage)(?:<[^>]+>)?\s([\s\S]*?)(?:\/>|>\s*\n)/g;

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

/** Statik route → çizdiği ilk sayfa bileşeni + route gövdesi (bileşene geçirilen `title` için). */
function routeComponents(): Array<{ path: string; component: string; body: string }> {
  const chunks = ROUTES_SRC.split(/path:\s*"/).slice(1);
  const out: Array<{ path: string; component: string; body: string }> = [];
  for (const chunk of chunks) {
    const path = chunk.slice(0, chunk.indexOf('"'));
    if (path.includes(":") || path === "*") continue;
    const body = chunk.slice(0, chunk.search(/\n {2}\},?\n|\n {2}\{ path/) + 1 || undefined);
    const comp = [...body.matchAll(/<([A-Z]\w*)/g)].map((m) => m[1]!).find((n) => !WRAPPERS.has(n));
    if (comp) out.push({ path: `/${path.replace(/^\//, "")}`, component: comp, body });
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

type Title =
  | { kind: "literal"; value: string }
  | { kind: "screen"; path: string }
  | { kind: "screen-dynamic" }
  | { kind: "expr"; text: string };

/** `title={…}` ifadesini dengeli süslü parantezle keser (şablon dizgisindeki `${}` dahil). */
function braceExpr(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

/** Bir öznitelik öbeğindeki İLK `title` değeri. */
function titleOf(attrs: string): Title | null {
  const at = /\btitle=(["{])/.exec(attrs);
  if (!at) return null;
  if (at[1] === '"') return { kind: "literal", value: attrs.slice(at.index + 7, attrs.indexOf('"', at.index + 7)) };
  const expr = braceExpr(attrs, at.index + 6).trim();
  const lit = /screenTitle\("([^"]+)"\)/.exec(expr);
  if (lit) return { kind: "screen", path: lit[1]! };
  if (/screenTitle\(/.test(expr)) return { kind: "screen-dynamic" };
  return { kind: "expr", text: expr };
}

/** Başlık taşıyan iskeletlerin (`PageHeader` · `CrudPage<T>` · `ReportPageLayout` · `ReportHubGrid` · `SettingsSurfacePage`) `title`ı. */
function titlesIn(src: string): Title[] {
  return [...src.matchAll(SKELETON)].map((m) => titleOf(m[1]!)).filter((t): t is Title => t !== null);
}

/** Route öğesine doğrudan geçirilen `title` (ör. `<SettingsSurfacePage title=… />`): sayfa dosyası onu yalnız aktarır. */
function routeTitle(body: string, component: string): Title | null {
  const m = new RegExp(`<${component}\\b([\\s\\S]*?)/?>`).exec(body);
  return m ? titleOf(m[1]!) : null;
}

function measure() {
  const imports = importMap();
  const mismatches: string[] = [];
  const unmeasured: string[] = [];
  let checked = 0;
  for (const { path, component, body } of routeComponents()) {
    const entry = findCommandEntry(path);
    if (!entry || entry.deep) continue;
    const mod = imports.get(component);
    const file = mod ? fileOf(mod) : null;
    if (!file) continue;
    const fromRoute = routeTitle(body, component);
    const titles = fromRoute ? [fromRoute] : titlesIn(readFileSync(file, "utf8"));
    if (titles.length === 0) {
      unmeasured.push(path);
      continue;
    }
    checked++;
    const expected = screenTitle(path);
    for (const t of titles) {
      if (t.kind === "screen" && t.path !== path) mismatches.push(`${path}: screenTitle("${t.path}") başka ekranın adı`);
      if (t.kind === "literal" && t.value !== expected) mismatches.push(`${path}: sayfa "${t.value}" ≠ menü "${expected}"`);
      if (t.kind === "expr") mismatches.push(`${path}: başlık ifadeyle çiziliyor (${t.text}) — screenTitle("${path}") kullan`);
    }
  }
  return { mismatches, unmeasured, checked };
}

describe("O34 — menü adı ↔ sayfa başlığı", () => {
  const { mismatches, unmeasured, checked } = measure();

  it("körlük zemini: yeterli sayıda sayfa başlığı ölçüldü", () => {
    expect(checked).toBeGreaterThanOrEqual(90);
  });

  it("⭐ menüde girişi olan her sayfanın başlığı menü adıyla aynı (screenTitle ya da birebir literal)", () => {
    const open = mismatches.filter((m) => !Object.keys(AYRISMA_MUAF).some((k) => m.startsWith(`${k}:`)));
    expect(open, `ayrışan başlık(lar):\n${open.join("\n")}`).toEqual([]);
  });

  it("başlığı ölçülemeyen sayfa yalnız gerekçeli muafta", () => {
    expect(unmeasured.filter((p) => !(p in OLCUM_DISI))).toEqual([]);
  });

  it("muaf listeleri bayat değil", () => {
    const dead = Object.keys(AYRISMA_MUAF).filter((k) => !mismatches.some((m) => m.startsWith(`${k}:`)));
    expect(dead).toEqual([]);
    expect(Object.keys(OLCUM_DISI).filter((p) => !unmeasured.includes(p))).toEqual([]);
  });

  it("screenTitle katalog adını döner (sekme adıyla aynı kaynak)", () => {
    expect(screenTitle("/definitions/cariler")).toBe("Cariler");
  });
});

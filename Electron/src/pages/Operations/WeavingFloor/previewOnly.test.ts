// Tezgah Salonu iki kapıdan girilir: uygulamada route (`tezgahEnabled` + `loom:live-view`,
// gerçek veri), geliştirmede önizleme (örnek veri). Örnek veri (`mock/`) uygulamaya SIZMAZ:
// onu klasör dışından yalnız önizleme, klasör içinden yalnız `mock/` ve testler içe aktarır.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_MODULE } from "@/lib/route-modules";

const SRC = resolve(__dirname, "../../..");
const FOLDER = "pages/Operations/WeavingFloor/";
const PREVIEW = "preview/weavingFloorPreview.tsx";
const ROUTES = "routes/content-routes.tsx";
const TILES = "pages/Operations/tile-config.ts";
const TILES_TEST = "pages/Operations/tile-visibility.test.ts";
const IMPORT_RE = /(?:from\s+|import\s*\()\s*["'][^"']*WeavingFloor\/?[^"']*["']/;
const MOCK_IMPORT_RE = /(?:from\s+|import\s*\()\s*["'][^"']*(?:WeavingFloor\/mock|\.\/mock|\.\.\/mock)\/[^"']*["']/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((f) => relative(SRC, f).split("\\").join("/"));
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("Tezgah Salonu — kapılar ve örnek veri sınırı", () => {
  it("klasör dışından içe aktaranlar yalnız önizleme, route tablosu ve karo yüklemi (+ karo testi)", () => {
    const importers = files.filter((rel) => !rel.startsWith(FOLDER) && IMPORT_RE.test(read(rel)));
    expect(importers.sort()).toEqual([TILES, TILES_TEST, PREVIEW, ROUTES].sort());
    expect(read(TILES)).toMatch(/from "\.\/WeavingFloor\/floor-regime"/);
  });

  it("⭐ örnek veriyi (mock/) uygulama kodu içe aktarmaz — yalnız önizleme ve testler", () => {
    const users = files.filter((rel) => !rel.startsWith(`${FOLDER}mock/`) && !/\.test\.tsx?$/.test(rel) && MOCK_IMPORT_RE.test(read(rel)));
    expect(users).toEqual([PREVIEW]);
  });

  it("⭐ route modül + izin kapılı: `tezgahEnabled` ve `loom:live-view`", () => {
    expect(ROUTE_MODULE["operations/weaving-floor"]).toBe("tezgahEnabled");
    const src = read(ROUTES);
    const at = src.indexOf('path: "operations/weaving-floor"');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("},", at));
    expect(block).toMatch(/<ProtectedRoute requirePermission="loom:live-view">\s*<WeavingFloorPage \/>/);
  });

  it("önizleme girişi üretim derlemesinde açılmaz", () => {
    expect(read(PREVIEW)).toMatch(/if \(!import\.meta\.env\.DEV\) throw/);
  });
});

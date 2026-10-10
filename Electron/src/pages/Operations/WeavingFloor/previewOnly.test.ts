// Tezgah Salonu ÖRNEK VERİ gösterir ⇒ sahaya çıkmaz: uygulamada route/karo YOK, sayfayı
// klasör dışından yalnız geliştirme önizlemesi içe aktarır. Gerçek veri dilimi
// (DOKUMA-CANLI-EKRAN.md §9) bu testi `tezgahEnabled` kapılı route ile birlikte değiştirir.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../..");
const FOLDER = "pages/Operations/WeavingFloor/";
const ALLOWED = new Set(["preview/weavingFloorPreview.tsx"]);
const IMPORT_RE = /(?:from\s+|import\s*\()\s*["'][^"']*WeavingFloor\/?[^"']*["']/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("Tezgah Salonu yalnız önizlemede", () => {
  it("klasör dışında sayfayı içe aktaran tek dosya geliştirme önizlemesidir", () => {
    const importers = walk(SRC)
      .map((f) => relative(SRC, f).split("\\").join("/"))
      .filter((rel) => !rel.startsWith(FOLDER))
      .filter((rel) => IMPORT_RE.test(readFileSync(join(SRC, rel), "utf8")));
    expect(importers.filter((rel) => !ALLOWED.has(rel))).toEqual([]);
    expect(importers).toEqual([...ALLOWED]);
  });

  it("önizleme girişi üretim derlemesinde açılmaz", () => {
    const entry = readFileSync(join(SRC, "preview/weavingFloorPreview.tsx"), "utf8");
    expect(entry).toMatch(/if \(!import\.meta\.env\.DEV\) throw/);
  });
});

// AYNA BEKÇİSİ: tel tipleri, uç tablosu, izin literalleri ve rapor aile eşlemesi bulut sunucusuyla
// aynı mı. Sunucu YALNIZ DOSYA olarak okunur (kaynak metni + üretilmiş `catalog/katalog-ozeti.json`); içe aktarılmaz —
// sunucunun bağımlılıkları bu işte kurulu değil, tip denetimi ve jest sunucu kaynağına uzanamaz.
import { readFileSync, readdirSync, statSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { ENDPOINTS } from "../src/api/endpoints";
import { DASHBOARD_CARDS, MODULES } from "../src/lib/access";
import { REPORT_FAMILY_PERMISSION, REPORTS_NOT_IN_CLOUD } from "../src/lib/reports";

const ROOT = join(__dirname, "..");
const SERVER = join(ROOT, "..", "sunucu", "src");

/** Bulut kataloğunun üretilmiş özeti (tek kaynak `patron/sunucu/src/catalog/*.ts`; tazeliği `test_katalog_ozeti`). */
interface KatalogOzeti {
  readonly CLOUD_PERMISSIONS: readonly string[];
  readonly PROJECTION_PERMISSIONS: Readonly<Record<string, readonly string[]>>;
  readonly REPORT_FAMILY_PERMISSION: Readonly<Record<string, string>>;
  readonly REPORTS_NOT_IN_CLOUD: readonly string[];
}
const OZET = JSON.parse(readFileSync(join(SERVER, "catalog/katalog-ozeti.json"), "utf8")) as KatalogOzeti;

/** Uygulama kökünün DIŞINA çıkan göreli içe aktarımlar (statik `from` · `import(` · `require(`). */
function outsideImports(file: string, src: string): string[] {
  const specs = [...src.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["'](\.{1,2}\/[^"']+)["']/gm)].map((m) => m[1]!);
  return specs.filter((s) => relative(ROOT, resolve(dirname(file), s)).startsWith(".."));
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("ayna: patron/sunucu ↔ patron/uygulama", () => {
  it("tel tipleri BAYT-EŞİT", () => {
    expect(readFileSync(join(ROOT, "src/api/wire.ts"), "utf8")).toBe(readFileSync(join(SERVER, "wire/api.ts"), "utf8"));
  });

  it("uygulamanın çağırdığı her uç sunucunun API_ROUTES'unda var", () => {
    // Tablo parçalı olabilir: api-routes.ts'in içe aktardığı `./*-routes` dosyaları da tablonun parçasıdır (yayılır).
    const main = readFileSync(join(SERVER, "http/api-routes.ts"), "utf8");
    const parts = [...main.matchAll(/from "\.\/([a-z-]+-routes)"/g)].map((m) => readFileSync(join(SERVER, `http/${m[1]!}.ts`), "utf8"));
    const text = [main, ...parts].join("\n");
    // Yol şablon literaliyle de yazılır (`/veri/:${PROJECTION}`): sabitler metinden çözülür.
    const consts = new Map([...text.matchAll(/const ([A-Z_]+) = "([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
    const resolve = (p: string) => p.replace(/\$\{([A-Z_]+)\}/g, (_x, k: string) => consts.get(k) ?? `?${k}`);
    const server = new Set([...text.matchAll(/method:\s*"(get|post|patch|delete)",\s*path:\s*["`]([^"`]+)["`]/g)].map((m) => `${m[1]} ${resolve(m[2]!)}`));
    expect(server.size).toBeGreaterThan(20); // desen körleşirse boş küme sahte yeşil verir
    const missing = Object.values(ENDPOINTS).map(([m, p]) => `${m} ${p}`).filter((k) => !server.has(k));
    expect(missing).toEqual([]);
  });

  it("uygulamadaki her 'bulut:' izin literali bulut kataloğunda var", () => {
    const known = new Set<string>(OZET.CLOUD_PERMISSIONS);
    expect(known.size).toBeGreaterThan(10);
    const used = new Set<string>();
    for (const f of [...files(join(ROOT, "src")), ...files(join(ROOT, "app"))]) {
      for (const m of readFileSync(f, "utf8").matchAll(/"(bulut:[a-z-]+(?::[a-z-]+)?)"/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(10);
    expect([...used].filter((p) => !known.has(p))).toEqual([]);
  });

  it("pano kartı izinleri sunucudaki projeksiyon izinleriyle aynı", () => {
    for (const c of DASHBOARD_CARDS) {
      const perms = OZET.PROJECTION_PERMISSIONS[c.projection];
      expect(perms && [...perms].sort()).toEqual([...c.allOf].sort());
    }
  });

  it("rapor aile → izin eşlemesi ve buluta gitmeyenler aynı", () => {
    expect(Object.keys(OZET.REPORT_FAMILY_PERMISSION).length).toBeGreaterThan(0);
    expect(REPORT_FAMILY_PERMISSION).toEqual(OZET.REPORT_FAMILY_PERMISSION);
    expect(REPORTS_NOT_IN_CLOUD).toEqual(OZET.REPORTS_NOT_IN_CLOUD);
  });

  it("uygulama kökünün dışını içe aktarmaz (sunucu kaynağı dahil; paylaşılan sözleşme bayt-eşit aynayla gelir)", () => {
    const all = ["src", "app", "__tests__", "scripts"].flatMap((d) => files(join(ROOT, d)));
    expect(all.length).toBeGreaterThan(20);
    const bad = all.flatMap((f) => outsideImports(f, readFileSync(f, "utf8")).map((s) => `${relative(ROOT, f)} → ${s}`));
    expect(bad).toEqual([]);
    // Kalıcı sonda: kök dışı (statik · dinamik · require) ısırır, kök içi susar.
    // Belirteç parçalı kurulur ki sonda satırı bu dosyanın kendi taramasında ısırmasın.
    const probe = join(ROOT, "__tests__", "probe.ts");
    const out = ["..", "..", "sunucu", "src", "wire", "api"].join("/");
    expect(outsideImports(probe, `import { A } from "${out}";`)).toHaveLength(1);
    expect(outsideImports(probe, `const m = await import("${out}");`)).toHaveLength(1);
    expect(outsideImports(probe, `const m = require("${out}");`)).toHaveLength(1);
    expect(outsideImports(probe, `import { A } from "../src/api/wire";\nimport "./setup";`)).toEqual([]);
  });

  it("modül tanımları tek anahtarlı ve rotalı", () => {
    expect(new Set(MODULES.map((m) => m.key)).size).toBe(MODULES.length);
    for (const m of MODULES) expect(m.route.startsWith("/")).toBe(true);
  });
});

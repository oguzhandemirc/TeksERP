// AYNA BEKÇİSİ: tel tipleri, uç tablosu, izin literalleri ve rapor aile eşlemesi bulut sunucusuyla
// aynı mı. Sunucu kataloğu saf modüldür (yalnız tip içe aktarır) — doğrudan içe aktarılır.
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { ENDPOINTS } from "../src/api/endpoints";
import { DASHBOARD_CARDS, MODULES } from "../src/lib/access";
import { REPORT_FAMILY_PERMISSION, REPORTS_NOT_IN_CLOUD } from "../src/lib/reports";
import { CLOUD_PERMISSIONS } from "../../sunucu/src/catalog/permissions";
import { projectionDef } from "../../sunucu/src/catalog/projections";
import * as serverReports from "../../sunucu/src/catalog/reports";

const ROOT = join(__dirname, "..");
const SERVER = join(ROOT, "..", "sunucu", "src");

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
    const known = new Set<string>(CLOUD_PERMISSIONS);
    const used = new Set<string>();
    for (const f of [...files(join(ROOT, "src")), ...files(join(ROOT, "app"))]) {
      for (const m of readFileSync(f, "utf8").matchAll(/"(bulut:[a-z-]+(?::[a-z-]+)?)"/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(10);
    expect([...used].filter((p) => !known.has(p))).toEqual([]);
  });

  it("pano kartı izinleri sunucudaki projeksiyon izinleriyle aynı", () => {
    for (const c of DASHBOARD_CARDS) {
      const def = projectionDef(c.projection);
      expect(def && [...def.permissions].sort()).toEqual([...c.allOf].sort());
    }
  });

  it("rapor aile → izin eşlemesi ve buluta gitmeyenler aynı", () => {
    expect(REPORT_FAMILY_PERMISSION).toEqual(serverReports.REPORT_FAMILY_PERMISSION);
    expect(REPORTS_NOT_IN_CLOUD).toEqual(serverReports.REPORTS_NOT_IN_CLOUD);
  });

  it("modül tanımları tek anahtarlı ve rotalı", () => {
    expect(new Set(MODULES.map((m) => m.key)).size).toBe(MODULES.length);
    for (const m of MODULES) expect(m.route.startsWith("/")).toBe(true);
  });
});

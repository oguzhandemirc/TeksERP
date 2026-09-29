// =============================================================================
// Kod koruma 2a — YOL SONDASI: dosya yolu çözen src modülleri pakette doğru yeri buluyor mu?
// =============================================================================
// Aynı giriş iki biçimde koşulur ve çıktılar karşılaştırılır:
//   kaynak : npx tsx scripts/olcum/yol-sondasi.ts          (cwd = Teks-Erp/)
//   paket  : node dist/yol-sondasi.cjs                     (cwd = paket app/ kökü)
// `paket-provasi.ts` ikincisini esbuild ile sunucuyla AYNI seçeneklerle üretir.
// DB'ye bağlanmaz, yazmaz; yalnız dosya sistemi okur ve JSON basar.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import swaggerJSDoc from "swagger-jsdoc";
import { APP_VERSION } from "../../src/lib/app-version";
import { MOBILE_UPDATE_ROOT } from "../../src/config/mobile-update";
import { swaggerOptions } from "../../src/config/swagger";
import { readAppDiskMetrics } from "../../src/lib/disk-metrics";
import { resolveLicenseDir } from "../../src/lib/license/store";
import { getLabelFontMetrics } from "../../src/services/helpers/raster/raster-font";
import { readExpectedMigrations } from "../../src/services/db-copy-verify.service";

type Probe = { ok: boolean; value: unknown; note?: string };

function tryProbe(fn: () => { ok: boolean; value: unknown; note?: string }): Probe {
  try {
    return fn();
  } catch (e) {
    return { ok: false, value: null, note: (e as Error).message };
  }
}

const cwd = process.cwd();
const rel = (p: string): string => path.relative(cwd, p) || ".";

const result: Record<string, Probe> = {
  "lib/app-version": tryProbe(() => ({ ok: APP_VERSION !== "1.0.0", value: APP_VERSION })),
  "config/mobile-update": tryProbe(() => ({ ok: path.isAbsolute(MOBILE_UPDATE_ROOT), value: rel(MOBILE_UPDATE_ROOT) })),
  "config/swagger": tryProbe(() => {
    const apis = (swaggerOptions as { apis?: string[] }).apis ?? [];
    const spec = swaggerJSDoc(swaggerOptions) as { paths?: Record<string, unknown> };
    const count = Object.keys(spec.paths ?? {}).length;
    return { ok: count > 0, value: { pathCount: count, firstGlob: apis[0] ? rel(apis[0]) : null } };
  }),
  "lib/disk-metrics": tryProbe(() => {
    const m = readAppDiskMetrics();
    return { ok: m.diskTotalBytes !== null, value: m.diskTotalBytes !== null ? "olculdu" : null };
  }),
  "lib/license/store": tryProbe(() => {
    const r = resolveLicenseDir();
    return { ok: r.problem === null, value: rel(r.dir), note: r.problem ?? undefined };
  }),
  "helpers/raster/raster-font": tryProbe(() => {
    const m = getLabelFontMetrics("normal");
    return { ok: m.unitsPerEm > 0, value: { unitsPerEm: m.unitsPerEm } };
  }),
  "db-copy-verify.readExpectedMigrations": tryProbe(() => {
    const list = readExpectedMigrations();
    return { ok: list.length > 0, value: list.length };
  }),
  "backup-impact.toolPath": tryProbe(() => {
    const p = path.join(cwd, "dist", "tools", "yedek-sifrele.cjs");
    return { ok: fs.existsSync(p), value: rel(p) };
  }),
  "app.publicDir": tryProbe(() => {
    const p = path.join(cwd, "public");
    return { ok: fs.existsSync(p), value: rel(p) };
  }),
};

process.stdout.write(JSON.stringify({ cwd: path.basename(cwd), result }, null, 2) + "\n");

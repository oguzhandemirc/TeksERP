// =============================================================================
// BEKÇİ — PATRON PANOSU UCU: `/api/patron/v1/pano[/kutular]` (2026-11-14)
// =============================================================================
//   §1 statik: toplu kapı (verifyToken + patron-app:login + pano izin kümesi) uçlardan ÖNCE · app.ts mount'u genel
//      `/api/patron/v1` okuma router'ından ÖNCE · `/auth/me` `patronPano` · veri panelin servisinden (ayrı hesap yok)
//   §2 şema: kutular zorunlu, tanınmayan dönem/alan 400; tanınmayan kutu anahtarı `parseBoxKeys` ile 400
// Sunucusuz (DB'ye yazmaz). NEGATİF SONDA: toplu kapı satırı uçların altına taşınınca §1a kırmızı; `kutular`
// şemadan `optional()` yapılınca §2a kırmızı (2026-11-14 elle denendi).
// Koşum: npx tsx scripts/run-all-tests.ts patron_pano_ucu
// =============================================================================
import prisma, { pool } from "../src/lib/prisma"; // İLK import: dotenv.config()
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { patronPanoQuerySchema, patronPanoCatalogQuerySchema } from "../src/routes/patron-pano.routes";
import { parseBoxKeys } from "../src/services/dashboard/pano-kutular.service";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const SRC = join(__dirname, "..", "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

function statik(): void {
  console.log("\n§1 statik");
  const route = read("routes/patron-pano.routes.ts");
  const gate = route.search(/router\.use\(verifyToken, requirePermission\(PATRON_LOGIN_PERMISSION\), requireAnyPermission\(\.\.\.PANO_ROUTE_PERMISSIONS\)\)/);
  const firstRoute = route.search(/router\.get\(/);
  check("§1a toplu kapı (kimlik + patron-app:login + pano izinleri) ilk uçtan ÖNCE", gate > 0 && firstRoute > gate);
  check("§1b veri panelin kutu servisinden (getPanoBoxCatalog / getPanoBoxes)", /getPanoBoxCatalog\(/.test(route) && /getPanoBoxes\(/.test(route));
  const app = read("app.ts");
  const pano = app.indexOf('app.use("/api/patron/v1/pano", patronPanoRoutes)');
  const read1 = app.indexOf('app.use("/api/patron/v1", patronReadRoutes)');
  check("§1c app.ts: pano mount'u genel okuma router'ından önce", pano > 0 && read1 > pano);
  const me = read("controllers/auth.controller.ts");
  check("§1d /auth/me patronPano sürümünü yayımlar", /patronPano: PATRON_PANO_VERSION/.test(me));
}

function sema(): void {
  console.log("\n§2 şema");
  check("§2a kutular verilmezse ret", !patronPanoQuerySchema.safeParse({}).success);
  check("§2b geçerli istek", patronPanoQuerySchema.safeParse({ kutular: "uretim,sevk", donem: "hafta" }).success);
  check("§2c tanınmayan dönem ret", !patronPanoQuerySchema.safeParse({ kutular: "uretim", donem: "gun" }).success);
  check("§2d tanınmayan alan ret (strict)", !patronPanoQuerySchema.safeParse({ kutular: "uretim", gun: "2026-11-14" }).success);
  check("§2e katalog sorgusu alan almaz", !patronPanoCatalogQuerySchema.safeParse({ x: "1" }).success);
  let unknown = false;
  try { parseBoxKeys("uretim,yokBoyleKutu"); } catch (e) { unknown = (e as { details?: { code?: string } }).details?.code === "PANO_BOX_UNKNOWN"; }
  check("§2f tanınmayan kutu anahtarı 400 PANO_BOX_UNKNOWN", unknown);
}

async function main(): Promise<void> {
  try {
    statik();
    sema();
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

void main();

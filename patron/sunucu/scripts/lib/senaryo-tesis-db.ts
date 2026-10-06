// Fabrika tarafı Senaryo P düzeneğinin tesis DB köprüsü (Teks-Erp patron kaynağını import edemez: rootDir).
// YALNIZ `_test` merkezinde: `url` tesis DB'sinin göç + uygulama rolü URL'lerini stdout'a JSON basar (parola
// geçici kökteki test anahtarından türer, yalnız boruya gider), `temizle` tesisin DB'sini, rollerini ve merkez satırlarını düşürür.
//   node --import tsx scripts/lib/senaryo-tesis-db.ts url|temizle <tesisId>   (ortam: GOC_DATABASE_URL, DATABASE_URL, ANAHTAR_DIZINI)
import { FacilityDbKey, facilityDbKeyPath } from "../../src/auth/facility-db-key";
import { facilityDbName, facilityRoles, withDatabase } from "../../src/lib/tesis-db-ad";
import { dropTestFacilityDb, testCentral } from "./tesis-db-temizlik";

async function main(): Promise<void> {
  const [komut, tesisId] = process.argv.slice(2);
  const gocUrl = process.env.GOC_DATABASE_URL ?? "";
  const appUrl = process.env.DATABASE_URL ?? "";
  if (!tesisId || !gocUrl || !appUrl) throw new Error("Kullanım: senaryo-tesis-db.ts url|temizle <tesisId> (GOC_DATABASE_URL + DATABASE_URL)");
  const central = testCentral(gocUrl);
  if (komut === "temizle") return dropTestFacilityDb(gocUrl, tesisId);
  if (komut !== "url") throw new Error(`Bilinmeyen komut: ${komut}`);
  const database = facilityDbName(central, tesisId);
  const k = facilityDbKeyPath(process.env, process.cwd());
  const key = FacilityDbKey.load(k.file, { create: false });
  const app = facilityRoles(database).app;
  process.stdout.write(JSON.stringify({ goc: withDatabase(gocUrl, database), app: withDatabase(appUrl, database, { user: app, password: key.rolePassword(app) }) }));
}

main().catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});

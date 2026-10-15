// =============================================================================
// TESİS VERİTABANLARI CLI'si — göç rolüyle (VDS'te `patron-goc` / `patron-hazirla` konteynerinden).
//   npx tsx scripts/tesis-db.ts hazirla --tesis=<uuid>   (tek tesis, eşzamanlı; yarım kalan tamamlanır)
//   npx tsx scripts/tesis-db.ts izle [--aralik=10]       (ISTENDI satırlarını yoklar — `patron-hazirla` servisi)
//   npx tsx scripts/tesis-db.ts durum                    (tesis DB'lerinin durumu; sır basmaz)
//   npx tsx scripts/tesis-db.ts goc                      (HAZIR tesis DB'lerine eksik göçler, TEK TEK; merkez ÖNCE
//        `prisma migrate deploy` + `db-rolleri` ile — `patron-goc` zinciri; bir tesisin hatası ötekini durdurmaz,
//        rapor basılır, hata varsa çıkış 1)
//   npx tsx scripts/tesis-db.ts ozet-yenile [--apply] (anahtar değişiminden sonra: bağlı kimliklerin e-posta özetini
//        geçerli anahtarla yeniden hesaplar; kuru koşum varsayılan, yalnız kimlik kimliği + sayı basar; çakışmada
//        HİÇ yazmaz; anahtar dosyası YOKSA üretmez, durur — PATRON-TESIS-DB §6)
// Anahtar: `TESIS_ROL_ANAHTARI_DOSYASI` (üretim sırrı) ya da `ANAHTAR_DIZINI/patron-tesis-db.key`.
// =============================================================================
import { Client } from "pg";
import { z } from "zod";
import { FacilityDbKey, facilityDbKeyPath } from "../src/auth/facility-db-key";
import { loadEnvFile } from "../src/lib/env";
import { PG_SESSION_OPTIONS } from "../src/lib/pg-session";
import { assertCentralName, databaseOf } from "../src/lib/tesis-db-ad";
import { centralSchemaVersion, migrateFacilityDbs, pendingFacilityDbs, prepareFacilityDb, type PrepareDeps, type PrepareOutcome } from "../src/lib/tesis-db-hazirlik";
import { expectedSchemaVersion } from "../src/lib/tesis-goc";
import { TesisDbRouter } from "../src/lib/tesis-db";
import { applyDigestRekey, describePlan, planDigestRekey } from "../src/services/identity-rekey";

function args(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]!] = m[2] ?? "true";
  }
  return out;
}

export function cliDeps(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): PrepareDeps {
  const gocUrl = env.GOC_DATABASE_URL;
  if (!gocUrl) throw new Error("GOC_DATABASE_URL tanımlı değil");
  const central = assertCentralName(databaseOf(gocUrl));
  if (central.startsWith("tekserp_fabrika_")) throw new Error("Fabrika verisi sınıfındaki DB'ye tesis DB'si açılmaz");
  const k = facilityDbKeyPath(env, cwd);
  return { gocUrl, key: FacilityDbKey.load(k.file, { create: !k.explicit }) };
}

function describe(tesisId: string, r: PrepareOutcome): string {
  switch (r.kind) {
    case "hazir":
      return `✅ ${tesisId} hazır — ${r.database} · şema ${r.schemaVersion} · ${r.applied.length} göç`;
    case "zaten-hazir":
      return `✅ ${tesisId} zaten hazır — ${r.database}`;
    case "mesgul":
      return `⏳ ${tesisId} başka hazırlayıcıda (claim süresi dolunca devralınır)`;
    case "bekliyor":
      return `⏳ ${tesisId} yeniden deneme beklemesinde`;
    case "imha":
      return `⛔ ${tesisId} imha durumunda (${r.status}) — hazırlanmaz`;
    case "hata":
      return `⛔ ${tesisId} hazırlanamadı: ${r.message}`;
  }
}

async function status(gocUrl: string): Promise<void> {
  const c = new Client({ connectionString: gocUrl, options: PG_SESSION_OPTIONS });
  await c.connect();
  try {
    const r = await c.query<{ tesis_id: string; status: string; database_name: string | null; schema_version: string | null; attempts: number; last_error: string | null; migration_error: string | null }>(
      `SELECT tesis_id, status, database_name, schema_version, attempts, last_error, migration_error FROM facility_databases ORDER BY created_at`,
    );
    for (const x of r.rows) {
      console.log(`${x.tesis_id} ${x.status} ${x.database_name ?? "-"} şema=${x.schema_version ?? "-"} deneme=${x.attempts}${x.last_error ? ` hata="${x.last_error}"` : ""}${x.migration_error ? ` göç="${x.migration_error}"` : ""}`);
    }
    console.log(`${r.rowCount} tesis DB kaydı`);
  } finally {
    await c.end();
  }
}

async function migrateAll(deps: PrepareDeps): Promise<number> {
  const expected = expectedSchemaVersion();
  const central = await centralSchemaVersion(deps.gocUrl);
  if (central !== expected) {
    console.error(`⛔ merkez şeması ${central ?? "yok"} ≠ beklenen ${expected} — önce \`prisma migrate deploy\` + \`db-rolleri\``);
    return 1;
  }
  const report = await migrateFacilityDbs(deps);
  let failed = 0;
  for (const r of report) {
    if (r.kind === "hata") {
      failed++;
      console.log(`⛔ ${r.tesisId} ${r.database}: ${r.message}`);
    } else {
      console.log(`✅ ${r.tesisId} ${r.database}: ${r.kind === "uygulandi" ? `${r.applied.length} göç uygulandı` : "güncel"} · şema ${r.schemaVersion}${r.checksumDrift.length ? ` · ⚠️ sağlama farkı: ${r.checksumDrift.join(",")}` : ""}`);
    }
  }
  console.log(`PATRON_TESIS_GOC tesis=${report.length} hata=${failed}`);
  return failed > 0 ? 1 : 0;
}

/** Özet yenileme: önce plan (kuru), `--apply` ile ve planda çakışma yoksa yazar. Çıkış 0 temiz · 1 çakışma/okunamayan/durdu. */
export async function rekeyDigests(env: NodeJS.ProcessEnv, cwd: string, apply: boolean, log: (line: string) => void = console.log): Promise<number> {
  const gocUrl = env.GOC_DATABASE_URL;
  if (!gocUrl) throw new Error("GOC_DATABASE_URL tanımlı değil");
  const k = facilityDbKeyPath(env, cwd);
  // Yeni anahtar burada ÜRETİLMEZ: yanlış yoldan doğan anahtar bütün özetleri ona yazardı.
  const key = FacilityDbKey.load(k.file, { create: false });
  const db = new TesisDbRouter({ role: "goc", centralUrl: gocUrl, key, schemaVersion: expectedSchemaVersion(), centralPoolMax: 2, facilityPoolMax: 2, cacheSeconds: 0 });
  try {
    const plan = await planDigestRekey(db, key);
    for (const line of describePlan(plan)) log(line);
    let code = plan.counts.cakisma > 0 || plan.counts.okunamadi > 0 ? 1 : 0;
    if (!apply) {
      log(`PATRON_OZET_YENILE kip=kuru yenilenecek=${plan.counts.yenilenecek} cakisma=${plan.counts.cakisma} — yazmak için --apply`);
      return code;
    }
    const r = await applyDigestRekey(db, key, plan);
    if (r.kind === "reddedildi") {
      log(`⛔ ${r.conflicts} kimlikte çakışma — HİÇBİR özet yazılmadı; çakışan kimlikler incelenmeli (runbook)`);
      log(`PATRON_OZET_YENILE kip=uygula degisen=0 cakisma=${r.conflicts}`);
      return 1;
    }
    if (r.kind === "durdu") {
      log(`⛔ ${r.stop.identityId} kimliğinde durdu (${r.stop.reason}) — ${r.changed} kimlik yazıldı; komutu yeniden koşun`);
      code = 1;
    }
    log(`PATRON_OZET_YENILE kip=uygula degisen=${r.changed} cakisma=${plan.counts.cakisma}`);
    return code;
  } finally {
    await db.close();
  }
}

async function watch(deps: PrepareDeps, seconds: number): Promise<void> {
  let stop = false;
  const wake: { fn: (() => void) | null } = { fn: null };
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      stop = true;
      wake.fn?.();
    });
  }
  console.log(`PATRON_HAZIRLA izliyor aralik=${seconds}s`);
  while (!stop) {
    try {
      for (const tesisId of await pendingFacilityDbs(deps.gocUrl)) {
        if (stop) break;
        console.log(describe(tesisId, await prepareFacilityDb({ ...deps, respectBackoff: true }, tesisId)));
      }
    } catch (err) {
      console.error(`[patron-hazirla] tur başarısız: ${(err as { code?: string }).code ?? (err as Error).name}`);
    }
    await new Promise<void>((r) => {
      const t = setTimeout(r, seconds * 1000);
      wake.fn = () => {
        clearTimeout(t);
        r();
      };
    });
  }
}

async function main(): Promise<number> {
  loadEnvFile();
  const [komut, ...rest] = process.argv.slice(2);
  const a = args(rest);
  if (komut === "ozet-yenile") return rekeyDigests(process.env, process.cwd(), a.apply === "true");
  const deps = cliDeps();
  switch (komut) {
    case "hazirla": {
      const tesisId = z.uuid().parse(a.tesis);
      const r = await prepareFacilityDb(deps, tesisId);
      console.log(describe(tesisId, r));
      return r.kind === "hazir" || r.kind === "zaten-hazir" ? 0 : 1;
    }
    case "izle":
      await watch(deps, z.coerce.number().int().min(1).max(3600).parse(a.aralik ?? "10"));
      return 0;
    case "durum":
      await status(deps.gocUrl);
      return 0;
    case "goc":
      return migrateAll(deps);
    default:
      console.error("Kullanım: tesis-db.ts hazirla --tesis=<uuid> | izle [--aralik=10] | durum | goc | ozet-yenile [--apply]");
      return 2;
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err: Error) => {
      console.error(`⛔ ${err.message}`);
      process.exit(1);
    });
}

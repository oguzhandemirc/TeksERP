// =============================================================================
// TESİS VERİTABANLARI CLI'si — göç rolüyle (VDS'te `patron-goc` / `patron-hazirla` konteynerinden).
//   npx tsx scripts/tesis-db.ts hazirla --tesis=<uuid>   (tek tesis, eşzamanlı; yarım kalan tamamlanır)
//   npx tsx scripts/tesis-db.ts izle [--aralik=10]       (ISTENDI satırlarını yoklar — `patron-hazirla` servisi)
//   npx tsx scripts/tesis-db.ts durum                    (tesis DB'lerinin durumu; sır basmaz)
// Anahtar: `TESIS_ROL_ANAHTARI_DOSYASI` (üretim sırrı) ya da `ANAHTAR_DIZINI/patron-tesis-db.key`.
// =============================================================================
import { Client } from "pg";
import { z } from "zod";
import { FacilityDbKey, facilityDbKeyPath } from "../src/auth/facility-db-key";
import { loadEnvFile } from "../src/lib/env";
import { PG_SESSION_OPTIONS } from "../src/lib/pg-session";
import { assertCentralName, databaseOf } from "../src/lib/tesis-db-ad";
import { pendingFacilityDbs, prepareFacilityDb, type PrepareDeps, type PrepareOutcome } from "../src/lib/tesis-db-hazirlik";

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
    default:
      console.error("Kullanım: tesis-db.ts hazirla --tesis=<uuid> | izle [--aralik=10] | durum");
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

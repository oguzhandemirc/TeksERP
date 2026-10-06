// =============================================================================
// BEKÇİ — tesis göç koşucusu (docs/design/PATRON-TESIS-DB.md §7). Gerçek PostgreSQL, `_test` merkezi.
//   §1 koşucu ↔ Prisma uyumu: koşucunun göç ettiği tesis DB'sini `prisma migrate status` GÜNCEL görür; şema
//      parmak izi (kolon · indeks · kısıt · politika · tetikleyici · fonksiyon · enum) Prisma'nın göç ettiği
//      merkezle BİREBİR. Negatif sondalar: tesise fazladan kolon → parmak izi farklı · yarım defter satırı → status RED.
//   §2 bir tesisin göç hatası ötekini DURDURMAZ: A hata (raporda, merkezde migration_error, şema sürümü eski) ·
//      B uygulandı (şema sürümü yeni).
//   §3 şeması geride tesis 503 TEKRAR_DENEYIN; güncel olan açılır.
//   §4 yarım kalan göç defteri A'yı kilitler (dokunulmaz, raporlanır), B ikinci koşumda güncel (idempotent).
//   §5 CLI `tesis-db.ts goc`: hatalı tesis varken çıkış 1 + tesis başına satır + özet.
// =============================================================================
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import { FacilityDbKey } from "../src/auth/facility-db-key";
import { CloudError } from "../src/lib/errors";
import { PG_SESSION_OPTIONS } from "../src/lib/pg-session";
import { withTesis } from "../src/lib/tenant";
import { TesisDbRouter } from "../src/lib/tesis-db";
import { databaseOf, facilityDbName, withDatabase } from "../src/lib/tesis-db-ad";
import { migrateFacilityDbs, prepareFacilityDb, type PrepareDeps } from "../src/lib/tesis-db-hazirlik";
import { expectedSchemaVersion, readMigrations, type MigrationFile } from "../src/lib/tesis-goc";
import { applyRoles } from "./db-rolleri";
import { dropTestFacilityDb } from "./lib/tesis-db-temizlik";
import { PATRON_KOKU, hedefDbKapisi, kontrol, sonuc } from "./lib/test-ortam";

hedefDbKapisi();
const GOC = process.env.GOC_DATABASE_URL!;
const MERKEZ = databaseOf(GOC);
const dizin = mkdtempSync(path.join(os.tmpdir(), "patron-goc-"));
const key = FacilityDbKey.load(path.join(dizin, "patron-tesis-db.key"), { create: true });
const deps: PrepareDeps = { gocUrl: GOC, key };

async function baglan(url: string): Promise<Client> {
  const c = new Client({ connectionString: url, options: PG_SESSION_OPTIONS });
  await c.connect();
  return c;
}

/** Şema parmak izi: DB adına bağlı parçalar (destek rolü adı) `<db>` ile normalleşir. */
async function parmakIzi(url: string): Promise<string[]> {
  const c = await baglan(url);
  try {
    const db = databaseOf(url);
    const q = async (sql: string) => (await c.query<{ s: string }>(sql)).rows.map((r) => r.s);
    const parts = [
      ...(await q(`SELECT 'kolon ' || table_name || '.' || column_name || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS s FROM information_schema.columns WHERE table_schema = 'public'`)),
      ...(await q(`SELECT 'indeks ' || indexname || ' ' || indexdef AS s FROM pg_indexes WHERE schemaname = 'public'`)),
      ...(await q(`SELECT 'kisit ' || conrelid::regclass::text || '.' || conname || ' ' || pg_get_constraintdef(oid) AS s FROM pg_constraint WHERE connamespace = 'public'::regnamespace`)),
      ...(await q(`SELECT 'politika ' || tablename || '.' || policyname || ' ' || permissive || ' ' || array_to_string(roles, ',') || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '') AS s FROM pg_policies WHERE schemaname = 'public'`)),
      ...(await q(`SELECT 'tetik ' || pg_get_triggerdef(t.oid) AS s FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid WHERE NOT t.tgisinternal AND r.relnamespace = 'public'::regnamespace`)),
      ...(await q(`SELECT 'fonksiyon ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || md5(p.prosrc) || ' ' || p.prosecdef::text AS s FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace`)),
      ...(await q(`SELECT 'enum ' || t.typname || ' ' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS s FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typnamespace = 'public'::regnamespace GROUP BY t.typname`)),
      ...(await q(`SELECT 'rls ' || relname || ' ' || relrowsecurity::text || ' ' || relforcerowsecurity::text AS s FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'`)),
    ];
    return parts.map((s) => s.split(db).join("<db>")).sort();
  } finally {
    await c.end();
  }
}

function fark(a: readonly string[], b: readonly string[]): string[] {
  const sa = new Set(a);
  const sb = new Set(b);
  return [...a.filter((x) => !sb.has(x)).map((x) => `- ${x}`), ...b.filter((x) => !sa.has(x)).map((x) => `+ ${x}`)];
}

function prismaStatus(url: string): { kod: number | null; cikti: string } {
  const r = spawnSync(process.execPath, [path.join(PATRON_KOKU, "node_modules/prisma/build/index.js"), "migrate", "status"], {
    cwd: PATRON_KOKU,
    env: { ...process.env, GOC_DATABASE_URL: url },
    encoding: "utf8",
    timeout: 120_000,
  });
  return { kod: r.status, cikti: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const SONDA_GOC = "29991231000000_bekci_goc_sondasi";

function sondaliZincir(): MigrationFile[] {
  const sql = "CREATE TABLE bekci_goc_sondasi (id integer)";
  return [...readMigrations(), { name: SONDA_GOC, sql, checksum: createHash("sha256").update(sql).digest("hex") }];
}

async function hazirla(tesisId: string): Promise<void> {
  const r = await prepareFacilityDb(deps, tesisId);
  if (r.kind !== "hazir") throw new Error(`hazırlık: ${JSON.stringify(r)}`);
}

async function main(): Promise<void> {
  await applyRoles(process.env);
  const a = randomUUID();
  const b = randomUUID();
  const urlA = withDatabase(GOC, facilityDbName(MERKEZ, a));
  const urlB = withDatabase(GOC, facilityDbName(MERKEZ, b));
  const merkez = await baglan(GOC);
  try {
    await hazirla(a);
    await hazirla(b);

    console.log("\n§1 koşucu ↔ Prisma uyumu");
    const st = prismaStatus(urlA);
    kontrol("§1a ⭐ `prisma migrate status` koşucunun göç ettiği tesis DB'sini GÜNCEL görür", st.kod === 0 && /up to date/i.test(st.cikti), (st.cikti.split("\n").find((l) => /up to date|migration/i.test(l)) ?? st.cikti).trim().slice(0, 120));
    const izM = await parmakIzi(GOC);
    const izA = await parmakIzi(urlA);
    const f1 = fark(izM, izA);
    kontrol("§1b ⭐ şema parmak izi (Prisma'lı merkez = koşuculu tesis) BİREBİR", f1.length === 0 && izA.length > 100, f1.slice(0, 4).join(" | ") || `${izA.length} parça`);
    const ca = await baglan(urlA);
    try {
      await ca.query("ALTER TABLE facilities ADD COLUMN bekci_sonda integer");
      const f2 = fark(izM, await parmakIzi(urlA));
      kontrol("§1c negatif sonda: tesise fazladan kolon → parmak izi FARKLI (ölçüm ısırır)", f2.some((x) => x.includes("bekci_sonda")), f2.join(" | ").slice(0, 120));
      await ca.query("ALTER TABLE facilities DROP COLUMN bekci_sonda");
      kontrol("§1d sonda geri alındı → parmak izi yeniden birebir", fark(izM, await parmakIzi(urlA)).length === 0);
      const sondaId = randomUUID();
      await ca.query(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, applied_steps_count) VALUES ($1, 'x', '29991231000001_bekci_yarim', now(), 0)`, [sondaId]);
      const yarim = prismaStatus(urlA);
      await ca.query(`DELETE FROM "_prisma_migrations" WHERE id = $1`, [sondaId]);
      kontrol("§1e negatif sonda: yarım defter satırı → `migrate status` GÜNCEL DEMEZ", yarim.kod !== 0 || !/up to date/i.test(yarim.cikti), `${yarim.kod}`);
    } finally {
      await ca.end();
    }

    console.log("\n§2 bir tesisin hatası ötekini durdurmaz");
    const zincir = sondaliZincir();
    const engel = await baglan(urlA);
    await engel.query("CREATE TABLE bekci_goc_sondasi (baska text)").finally(() => engel.end());
    const rapor = await migrateFacilityDbs({ gocUrl: GOC, migrations: zincir }, [a, b]);
    const rA = rapor.find((x) => x.tesisId === a);
    const rB = rapor.find((x) => x.tesisId === b);
    kontrol("§2a ⭐ A hata (raporda), B uygulandı (sonda göçü)", rA?.kind === "hata" && rB?.kind === "uygulandi" && rB.applied.join() === SONDA_GOC, JSON.stringify(rapor.map((x) => [x.tesisId.slice(0, 8), x.kind])));
    const satir = async (t: string) =>
      (await merkez.query<{ schema_version: string | null; migration_error: string | null }>(`SELECT schema_version, migration_error FROM facility_databases WHERE tesis_id = $1::uuid`, [t])).rows[0];
    const sA = await satir(a);
    const sB = await satir(b);
    kontrol("§2b merkezde A: migration_error dolu, şema sürümü ESKİ · B: şema sürümü YENİ, hata boş", !!sA?.migration_error && sA.schema_version === expectedSchemaVersion() && sB?.schema_version === SONDA_GOC && sB.migration_error === null, JSON.stringify({ sA, sB }));
    kontrol("§2c hata metni URL/parola taşımaz", !!sA?.migration_error && !/postgres(ql)?:\/\//.test(sA.migration_error), sA?.migration_error?.slice(0, 80));

    console.log("\n§3 şeması geride tesis 503");
    const router = new TesisDbRouter({ role: "goc", centralUrl: GOC, key, schemaVersion: SONDA_GOC, cacheSeconds: 0 });
    try {
      const ac = (t: string) =>
        withTesis(router, { tesisId: t }, async () => "acildi").then(
          (x) => x,
          (e: Error) => (e instanceof CloudError ? `${e.status} ${e.code}` : e.message.slice(0, 60)),
        );
      const gA = await ac(a);
      const gB = await ac(b);
      kontrol("§3a ⭐ şeması geride A → 503 TEKRAR_DENEYIN · güncel B açılır", gA === "503 TEKRAR_DENEYIN" && gB === "acildi", `${gA} · ${gB}`);
    } finally {
      await router.close();
    }

    console.log("\n§4 yarım göç defteri kilitler · ikinci koşum idempotent");
    const ikinci = await migrateFacilityDbs({ gocUrl: GOC, migrations: zincir }, [a, b]);
    const iA = ikinci.find((x) => x.tesisId === a);
    const iB = ikinci.find((x) => x.tesisId === b);
    kontrol("§4a A'nın yarım defteri: dokunulmaz, 'yarım kalmış göç' raporlanır · B güncel", iA?.kind === "hata" && /Yarım kalmış göç/.test(iA.message) && iB?.kind === "guncel", JSON.stringify(ikinci.map((x) => [x.kind, x.kind === "hata" ? x.message.slice(0, 40) : ""])));

    console.log("\n§5 CLI");
    const cli = spawnSync(process.execPath, ["--import", "tsx", "scripts/tesis-db.ts", "goc"], { cwd: PATRON_KOKU, env: process.env, encoding: "utf8", timeout: 120_000 });
    const out = `${cli.stdout ?? ""}${cli.stderr ?? ""}`;
    kontrol("§5a ⭐ hatalı tesis varken `tesis-db goc` çıkış 1 · A ⛔ · B ✅ · özet satırı", cli.status === 1 && out.includes(`⛔ ${a}`) && out.includes(`✅ ${b}`) && /PATRON_TESIS_GOC tesis=\d+ hata=1/.test(out), out.trim().split("\n").slice(-3).join(" | ").slice(0, 200));
  } finally {
    await merkez.end().catch(() => undefined);
    for (const t of [a, b]) await dropTestFacilityDb(GOC, t).catch((e: Error) => console.error(`temizlik: ${e.message}`));
    rmSync(dizin, { recursive: true, force: true });
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});

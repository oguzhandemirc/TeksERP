// =============================================================================
// BEKÇİ — tesis DB hazırlığı (docs/design/PATRON-TESIS-DB.md §5). Gerçek PostgreSQL, `_test` merkezi.
//   §1 ilk hazırlık: DB + iki tesis rolü (türetilmiş parola, NOSUPERUSER NOBYPASSRLS), bağlanma yalnız tesis
//      rollerine, DB bağı işareti, göç defteri tam, merkez tabloları tesiste yetkisiz, satır HAZIR.
//   §2 ikinci koşum idempotent · §3 yarım kalan (rol var DB yok / DB var göç yarım) tamamlanır.
//   §4 claim yarışında tek hazırlayıcı · süresi dolmuş claim devralınır.
//   §5 hata yolu: claim bırakılır, deneme + kısa hata + bekleme; yarım göç defteri DB'yi kilitler (P3009).
//   §6 ad çakışması reddedilir · merkez adı tavanı · merkez işareti.
//   §7 sunucu hazırlayıcıyı import ETMEZ (import grafiği; negatif sonda: CLI grafiği bulur).
// =============================================================================
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import { FacilityDbKey } from "../src/auth/facility-db-key";
import { PG_SESSION_OPTIONS } from "../src/lib/pg-session";
import { CENTRAL_MARK, assertCentralName, databaseOf, facilityDbName, facilityRoles, withDatabase } from "../src/lib/tesis-db-ad";
import { prepareFacilityDb, type PrepareDeps } from "../src/lib/tesis-db-hazirlik";
import { expectedSchemaVersion, migrateDatabase, readMigrations } from "../src/lib/tesis-goc";
import { applyRoles } from "./db-rolleri";
import { dropTestFacilityDb } from "./lib/tesis-db-temizlik";
import { PATRON_KOKU, hedefDbKapisi, kontrol, sonuc } from "./lib/test-ortam";

hedefDbKapisi();
const GOC = process.env.GOC_DATABASE_URL!;
const MERKEZ = databaseOf(GOC);
const dizin = mkdtempSync(path.join(os.tmpdir(), "patron-hazirlik-"));
const key = FacilityDbKey.load(path.join(dizin, "patron-tesis-db.key"), { create: true });
const deps: PrepareDeps = { gocUrl: GOC, key };
const acilan: string[] = [];

async function baglan(url: string): Promise<Client> {
  const c = new Client({ connectionString: url, options: PG_SESSION_OPTIONS });
  await c.connect();
  return c;
}

async function satir(goc: Client, tesisId: string) {
  const r = await goc.query<{ status: string; database_name: string | null; schema_version: string | null; attempts: number; last_error: string | null; claim_owner: string | null; next_attempt_at: Date | null }>(
    "SELECT status, database_name, schema_version, attempts, last_error, claim_owner, next_attempt_at FROM facility_databases WHERE tesis_id = $1::uuid",
    [tesisId],
  );
  return r.rows[0];
}

function yeniTesis(): string {
  const id = randomUUID();
  acilan.push(id);
  return id;
}

async function ilkHazirlik(goc: Client): Promise<string> {
  console.log("\n§1 ilk hazırlık");
  const tesisId = yeniTesis();
  const db = facilityDbName(MERKEZ, tesisId);
  const roles = facilityRoles(db);
  const r = await prepareFacilityDb(deps, tesisId);
  kontrol("§1a sonuç hazir", r.kind === "hazir", JSON.stringify(r).slice(0, 160));
  const s = await satir(goc, tesisId);
  kontrol("§1b satır HAZIR + ad + şema sürümü", s?.status === "HAZIR" && s.database_name === db && s.schema_version === expectedSchemaVersion(), JSON.stringify(s));
  const rol = await goc.query<{ rolname: string; rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>(
    "SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname",
    [[roles.app, roles.sync, roles.support]],
  );
  const by = new Map(rol.rows.map((x) => [x.rolname, x]));
  const calisma = [roles.app, roles.sync].every((n) => by.get(n)?.rolcanlogin === true && !by.get(n)?.rolsuper && !by.get(n)?.rolbypassrls && !by.get(n)?.rolcreatedb && !by.get(n)?.rolcreaterole);
  kontrol("§1c iki tesis rolü LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE", calisma);
  kontrol("§1d destek rolü NOLOGIN doğdu", by.get(roles.support)?.rolcanlogin === false);
  const merkezApp = decodeURIComponent(new URL(process.env.DATABASE_URL!).username);
  const conn = await goc.query<{ r: string; ok: boolean }>("SELECT r, has_database_privilege(r, $1, 'CONNECT') AS ok FROM unnest($2::text[]) r", [db, [roles.app, roles.sync, merkezApp]]);
  const cm = new Map(conn.rows.map((x) => [x.r, x.ok]));
  kontrol("§1e bağlanma yalnız tesis rollerine (merkez uygulama rolü BAĞLANAMAZ)", cm.get(roles.app) === true && cm.get(roles.sync) === true && cm.get(merkezApp) === false);
  const pub = await goc.query<{ acl: string | null }>("SELECT datacl::text AS acl FROM pg_database WHERE datname = $1", [db]);
  kontrol("§1f PUBLIC'in CONNECT'i geri alındı", !/(^|[{,])=[^,}]*c/.test(pub.rows[0]?.acl ?? ""), pub.rows[0]?.acl ?? "");
  const uyg = await baglan(withDatabase(GOC, db, { user: roles.app, password: key.rolePassword(roles.app) }));
  try {
    const m = await uyg.query<{ v: string | null }>("SELECT current_setting('app.veritabani_tesisi', true) AS v");
    kontrol("§1g türetilmiş parolayla bağlanılır; DB bağı işareti = tesis", m.rows[0]?.v === tesisId, m.rows[0]?.v ?? "");
    const p = await uyg.query<{ t: string; ok: boolean }>(
      "SELECT t, has_table_privilege(current_user, t, 'SELECT') AS ok FROM unnest(ARRAY['facility_databases','installation_routes','login_routes','facility_destructions','accounts','support_access']) t",
    );
    const pm = new Map(p.rows.map((x) => [x.t, x.ok]));
    kontrol(
      "§1h merkez tabloları tesiste yetkisiz; tesis tabloları yetkili",
      !pm.get("facility_databases") && !pm.get("installation_routes") && !pm.get("login_routes") && !pm.get("facility_destructions") && pm.get("accounts") === true && pm.get("support_access") === true,
      JSON.stringify([...pm]),
    );
  } finally {
    await uyg.end();
  }
  const tdb = await baglan(withDatabase(GOC, db));
  try {
    const g = await tdb.query<{ n: string; f: boolean }>(`SELECT migration_name AS n, finished_at IS NOT NULL AS f FROM "_prisma_migrations" ORDER BY migration_name`);
    kontrol("§1i göç defteri = göç dizini (hepsi bitmiş)", JSON.stringify(g.rows.filter((x) => x.f).map((x) => x.n)) === JSON.stringify(readMigrations().map((m) => m.name)), `${g.rowCount} satır`);
  } finally {
    await tdb.end();
  }
  return tesisId;
}

async function idempotent(tesisId: string): Promise<void> {
  console.log("\n§2 ikinci koşum");
  const r = await prepareFacilityDb(deps, tesisId);
  kontrol("§2a ikinci koşum zaten-hazir", r.kind === "zaten-hazir", r.kind);
}

async function yarimKalan(goc: Client): Promise<void> {
  console.log("\n§3 yarım kalan hazırlık tamamlanır");
  const a = yeniTesis();
  const dbA = facilityDbName(MERKEZ, a);
  const rolesA = facilityRoles(dbA);
  await goc.query(`CREATE ROLE "${rolesA.app}" LOGIN PASSWORD 'gecici-yanlis-parola-1234'`);
  await goc.query("INSERT INTO facility_databases (tesis_id) VALUES ($1::uuid)", [a]);
  const ra = await prepareFacilityDb(deps, a);
  kontrol("§3a rol var · DB yok → hazir", ra.kind === "hazir", ra.kind);
  const c = await baglan(withDatabase(GOC, dbA, { user: rolesA.app, password: key.rolePassword(rolesA.app) })).catch(() => null);
  kontrol("§3b önceden var olan rolün parolası türetilmişe hizalandı", c !== null);
  await c?.end();

  const b = yeniTesis();
  const dbB = facilityDbName(MERKEZ, b);
  await goc.query(`CREATE DATABASE "${dbB}"`);
  const yarim = await baglan(withDatabase(GOC, dbB));
  try {
    await migrateDatabase(yarim, readMigrations().slice(0, 3));
  } finally {
    await yarim.end();
  }
  const rb = await prepareFacilityDb(deps, b);
  kontrol("§3c DB var · göç yarım (3/N) → hazir, kalan göçler uygulandı", rb.kind === "hazir" && rb.applied.length === readMigrations().length - 3, rb.kind === "hazir" ? `${rb.applied.length} göç` : rb.kind);
}

async function claimYarisi(goc: Client): Promise<void> {
  console.log("\n§4 claim");
  const t = yeniTesis();
  const sonuclar = await Promise.all([prepareFacilityDb(deps, t), prepareFacilityDb(deps, t)]);
  const hazir = sonuclar.filter((x) => x.kind === "hazir").length;
  kontrol("§4a yarışta tek hazırlayıcı (bir hazir, öteki mesgul/zaten-hazir)", hazir === 1 && sonuclar.every((x) => ["hazir", "mesgul", "zaten-hazir"].includes(x.kind)), sonuclar.map((x) => x.kind).join(","));
  const u = yeniTesis();
  await goc.query("INSERT INTO facility_databases (tesis_id, claim_owner, claim_until) VALUES ($1::uuid, 'baska', now() + interval '5 minutes')", [u]);
  const r1 = await prepareFacilityDb(deps, u);
  kontrol("§4b süresi dolmamış başka claim → dokunulmaz (mesgul)", r1.kind === "mesgul", r1.kind);
  await goc.query("UPDATE facility_databases SET claim_until = now() - interval '1 second' WHERE tesis_id = $1::uuid", [u]);
  const r2 = await prepareFacilityDb(deps, u);
  kontrol("§4c süresi dolmuş claim devralınır → hazir", r2.kind === "hazir", r2.kind);
}

async function hataYolu(goc: Client): Promise<void> {
  console.log("\n§5 hata yolu");
  const t = yeniTesis();
  const bozuk = [...readMigrations(), { name: "99991231000000_bozuk_sonda", sql: "SELECT 1/0;", checksum: "0".repeat(64) }];
  const r = await prepareFacilityDb({ ...deps, migrations: bozuk }, t);
  const s = await satir(goc, t);
  kontrol("§5a göç hatası → hata; satır ISTENDI, claim bırakıldı", r.kind === "hata" && s?.status === "ISTENDI" && s.claim_owner === null, r.kind === "hata" ? r.message : r.kind);
  kontrol("§5b deneme +1, kısa hata, ileri tarihli yeniden deneme", s?.attempts === 1 && (s.last_error ?? "").includes("99991231000000_bozuk_sonda") && (s.next_attempt_at?.getTime() ?? 0) > Date.now(), JSON.stringify(s));
  kontrol("§5c hata metni URL/parola taşımaz", !/postgres(ql)?:\/\//.test(s?.last_error ?? "") && !(s?.last_error ?? "").includes(key.rolePassword(facilityRoles(facilityDbName(MERKEZ, t)).app)));
  const bekle = await prepareFacilityDb({ ...deps, respectBackoff: true }, t);
  kontrol("§5d izle kipi beklemeye uyar", bekle.kind === "bekliyor", bekle.kind);
  const kilitli = await prepareFacilityDb(deps, t);
  kontrol("§5e yarım göç defteri DB'yi kilitler (P3009 davranışı)", kilitli.kind === "hata" && kilitli.message.includes("Yarım kalmış göç"), kilitli.kind === "hata" ? kilitli.message : kilitli.kind);
}

async function adlar(goc: Client): Promise<void> {
  console.log("\n§6 adlar ve merkez işareti");
  const a = yeniTesis();
  const b = `${a.slice(0, 19)}${randomUUID().slice(19)}`;
  acilan.push(b);
  const ra = await prepareFacilityDb(deps, a);
  const rb = await prepareFacilityDb(deps, b);
  kontrol("§6a ilk 16 hanesi aynı iki tesis → ikincisi ad çakışmasıyla RED", ra.kind === "hazir" && rb.kind === "hata" && rb.message.includes("Ad çakışması"), rb.kind === "hata" ? rb.message : rb.kind);
  let red = false;
  try {
    assertCentralName("a".repeat(39));
  } catch {
    red = true;
  }
  kontrol("§6b merkez adı 38 karakteri aşamaz", red && assertCentralName("a".repeat(38)).length === 38);
  const m = await goc.query<{ v: string | null }>("SELECT current_setting('app.veritabani_tesisi', true) AS v");
  kontrol("§6c merkez DB bağı işareti 'merkez'", m.rows[0]?.v === CENTRAL_MARK, m.rows[0]?.v ?? "yok");
}

/** `src/` içi göreli import grafiği (tip importları dahil — yanlış pozitif güvenli tarafta). */
function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [path.resolve(entry)];
  while (stack.length > 0) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g)) {
      const base = path.resolve(path.dirname(f), m[1]!);
      const hit = [`${base}.ts`, path.join(base, "index.ts")].find((x) => existsSync(x));
      if (hit) stack.push(hit);
    }
  }
  return seen;
}

function sunucuGrafigi(): void {
  console.log("\n§7 sunucu hazırlayıcıyı import etmez");
  const hedef = path.join(PATRON_KOKU, "src/lib/tesis-db-hazirlik.ts");
  const sunucu = importGraph(path.join(PATRON_KOKU, "src/server.ts"));
  kontrol("§7a src/server.ts grafiğinde tesis-db-hazirlik YOK", !sunucu.has(hedef), `${sunucu.size} dosya`);
  const cli = importGraph(path.join(PATRON_KOKU, "scripts/tesis-db.ts"));
  kontrol("§7b negatif sonda: CLI grafiği hazırlayıcıyı BULUR (tarayıcı çalışıyor)", cli.has(hedef));
}

async function main(): Promise<void> {
  await applyRoles(process.env);
  const goc = await baglan(GOC);
  try {
    const t = await ilkHazirlik(goc);
    await idempotent(t);
    await yarimKalan(goc);
    await claimYarisi(goc);
    await hataYolu(goc);
    await adlar(goc);
    sunucuGrafigi();
  } finally {
    await goc.end();
    for (const id of acilan) await dropTestFacilityDb(GOC, id).catch((e: Error) => console.error(`temizlik: ${e.message}`));
    rmSync(dizin, { recursive: true, force: true });
  }
  sonuc();
}

void main();

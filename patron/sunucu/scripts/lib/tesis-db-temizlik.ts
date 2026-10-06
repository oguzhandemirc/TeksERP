// Bekçi tesis DB'lerinin temizliği — YALNIZ `_test` merkezine ait `<merkez>_t<16 onaltılık>` adları (fabrika
// verisi sınıfı ve başka merkezin DB'si asla). Veritabanı + üç tesis rolü + merkezdeki yönlendirme ve imha satırları.
// Koşucu her turun başında süpürür (çöken bekçinin artığı ve elle açılmış ölçüm DB'leri dahil).
import { Client } from "pg";
import { ident } from "../../src/lib/db-roles";
import { PG_SESSION_OPTIONS } from "../../src/lib/pg-session";
import { databaseOf, facilityDbName, facilityRoles, isFacilityDbOf } from "../../src/lib/tesis-db-ad";

function testCentral(gocUrl: string): string {
  const central = databaseOf(gocUrl);
  if (!central.endsWith("_test") || central.startsWith("tekserp_fabrika_")) throw new Error(`Temizlik yalnız _test merkezinde: ${central}`);
  return central;
}

async function dropOne(c: Client, central: string, database: string): Promise<void> {
  if (!isFacilityDbOf(central, database)) throw new Error(`Bu merkeze ait tesis DB adı değil: ${database}`);
  await c.query(`DROP DATABASE IF EXISTS ${ident(database)} WITH (FORCE)`);
  const roles = facilityRoles(database);
  for (const r of [roles.app, roles.sync, roles.support]) await c.query(`DROP ROLE IF EXISTS ${ident(r)}`);
}

/** Tek bekçi tesisinin DB'si, rolleri ve merkez satırları. */
export async function dropTestFacilityDb(gocUrl: string, tesisId: string): Promise<void> {
  const central = testCentral(gocUrl);
  const c = new Client({ connectionString: gocUrl, options: PG_SESSION_OPTIONS });
  await c.connect();
  try {
    await dropOne(c, central, facilityDbName(central, tesisId));
    await c.query("DELETE FROM installation_routes WHERE tesis_id = $1::uuid", [tesisId]);
    await c.query("DELETE FROM login_routes WHERE tesis_id = $1::uuid", [tesisId]);
    await c.query("DELETE FROM facility_databases WHERE tesis_id = $1::uuid", [tesisId]);
    // İmha bekçisinin merkeze yazdığı tutanak + destek kopyası (değiştirilemezlik tetikleyicisi yalnız bu tx'te susar).
    await c.query("BEGIN");
    try {
      await c.query("SET LOCAL session_replication_role = replica");
      await c.query("DELETE FROM facility_destructions WHERE tesis_id = $1::uuid", [tesisId]);
      await c.query("DELETE FROM support_access WHERE tesis_id = $1::uuid", [tesisId]);
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK");
      throw err;
    }
  } finally {
    await c.end();
  }
}

/** Bu `_test` merkezine ait BÜTÜN tesis DB'leri + yetim tesis rolleri + merkez yönlendirme satırları. */
export async function sweepTestFacilityDbs(gocUrl: string): Promise<number> {
  const central = testCentral(gocUrl);
  const c = new Client({ connectionString: gocUrl, options: PG_SESSION_OPTIONS });
  await c.connect();
  try {
    const dbs = await c.query<{ datname: string }>("SELECT datname FROM pg_database WHERE datname LIKE $1", [`${central}\\_t%`]);
    const names = dbs.rows.map((r) => r.datname).filter((n) => isFacilityDbOf(central, n));
    for (const n of names) await dropOne(c, central, n);
    const roles = await c.query<{ rolname: string }>("SELECT rolname FROM pg_roles WHERE rolname LIKE $1", [`${central}\\_t%`]);
    for (const r of roles.rows) {
      const m = /^(.*)_(uyg|esit|destek)$/.exec(r.rolname);
      if (m && isFacilityDbOf(central, m[1]!)) await c.query(`DROP ROLE IF EXISTS ${ident(r.rolname)}`);
    }
    await c.query("DELETE FROM installation_routes");
    await c.query("DELETE FROM login_routes");
    await c.query("DELETE FROM facility_databases");
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query("DELETE FROM facility_destructions");
    await c.query("DELETE FROM support_access");
    await c.query("COMMIT");
    return names.length;
  } finally {
    await c.end();
  }
}

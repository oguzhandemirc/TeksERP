// TESİS DB HAZIRLIĞI — atomik, idempotent; yarıda kalan hazırlık aynı adımlarla tamamlanır (§5).
// YALNIZ göç rolüyle (CLI `scripts/tesis-db.ts` + `patron-hazirla` servisi); sunucu bu modülü İMPORT ETMEZ
// (CREATE DATABASE / CREATE ROLE yetkisi ve göç parolası sunucuya girmez — bekçi ölçer).
// Adımlar: claim (süreli) → tesis rolleri (türetilmiş parola) → DB (+ bağlanma yalnız tesis rollerine, DB bağı
// işareti) → göç → yetkiler → HAZIR. Hata: claim bırakılır, deneme sayısı + kısa hata + artan bekleme yazılır.
import { randomUUID } from "node:crypto";
import os from "node:os";
import { Client } from "pg";
import type { FacilityDbKey } from "../auth/facility-db-key";
import { APP_COLUMN_GRANTS, APP_GRANTS, SYNC_COLUMN_GRANTS, SYNC_GRANTS } from "./db-grants";
import { applySupportRole, ensureLoginRole, grantAll, ident, markDatabase, restrictConnect } from "./db-roles";
import { PG_SESSION_OPTIONS } from "./pg-session";
import { databaseOf, facilityDbName, facilityRoles, withDatabase } from "./tesis-db-ad";
import { migrateDatabase, readMigrations, type MigrationFile } from "./tesis-goc";

/** Claim süresi: çöken hazırlayıcının claim'i bu süre dolunca devralınır. */
export const PREPARE_CLAIM_MINUTES = 10;
const BACKOFF_MAX_SECONDS = 600;

export interface PrepareDeps {
  /** Göç rolünün MERKEZ URL'i (tablo sahibi; CREATEDB + CREATEROLE). */
  readonly gocUrl: string;
  readonly key: FacilityDbKey;
  /** Claim sahibi etiketi (günlük ve tanı). */
  readonly owner?: string;
  readonly migrations?: readonly MigrationFile[];
  /** `izle` kipinde artan bekleme süresine uyulur; elle `hazirla` beklemez. */
  readonly respectBackoff?: boolean;
}

export type PrepareOutcome =
  | { readonly kind: "hazir"; readonly database: string; readonly schemaVersion: string; readonly applied: readonly string[] }
  | { readonly kind: "zaten-hazir"; readonly database: string }
  | { readonly kind: "mesgul" }
  | { readonly kind: "bekliyor" }
  | { readonly kind: "imha"; readonly status: string }
  | { readonly kind: "hata"; readonly message: string };

function client(url: string): Client {
  return new Client({ connectionString: url, options: PG_SESSION_OPTIONS });
}

/** Sırsız, kısa hata metni (parola/URL taşımaz: pg iletileri rol adı taşıyabilir, parola taşımaz). */
function shortError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  return `${e.code ? `${e.code} ` : ""}${(e.message ?? String(err)).replace(/postgres(ql)?:\/\/\S+/g, "<url>")}`.slice(0, 500);
}

/** Hazırlık isteği (idempotent): satır yoksa ISTENDI doğar. */
export async function requestFacilityDb(central: Client, tesisId: string): Promise<void> {
  await central.query(`INSERT INTO facility_databases (tesis_id) VALUES ($1::uuid) ON CONFLICT (tesis_id) DO NOTHING`, [tesisId]);
}

/** Tek tesisi hazırlar. Satır yoksa önce isteği açar (CLI yolu). */
export async function prepareFacilityDb(deps: PrepareDeps, tesisId: string): Promise<PrepareOutcome> {
  const centralName = databaseOf(deps.gocUrl);
  const database = facilityDbName(centralName, tesisId);
  const owner = (deps.owner ?? `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`).slice(0, 80);
  const central = client(deps.gocUrl);
  await central.connect();
  try {
    await requestFacilityDb(central, tesisId);
    let claimed;
    try {
      claimed = await central.query(
        `UPDATE facility_databases SET claim_owner = $2, claim_until = now() + make_interval(mins => $3), database_name = $4, updated_at = now()
          WHERE tesis_id = $1::uuid AND status = 'ISTENDI' AND (claim_until IS NULL OR claim_until < now())
            AND ($5::boolean IS FALSE OR next_attempt_at IS NULL OR next_attempt_at <= now())`,
        [tesisId, owner, PREPARE_CLAIM_MINUTES, database, deps.respectBackoff === true],
      );
    } catch (err) {
      // Ad çakışması (iki tesisin ilk 16 hanesi aynı) kendiliğinden düzeltilmez: hata satıra yazılır.
      if ((err as { code?: string }).code !== "23505") throw err;
      const message = `Ad çakışması: ${database} başka tesiste`;
      await central.query(`UPDATE facility_databases SET attempts = attempts + 1, last_error = $2, updated_at = now() WHERE tesis_id = $1::uuid`, [tesisId, message]);
      return { kind: "hata", message };
    }
    if (claimed.rowCount === 0) {
      const row = await central.query<{ status: string; next_attempt_at: Date | null }>(`SELECT status, next_attempt_at FROM facility_databases WHERE tesis_id = $1::uuid`, [tesisId]);
      const st = row.rows[0]?.status;
      if (st === "HAZIR") return { kind: "zaten-hazir", database };
      if (st === "IMHA_SURUYOR" || st === "IMHA_EDILDI") return { kind: "imha", status: st };
      const later = row.rows[0]?.next_attempt_at;
      return deps.respectBackoff && later && later.getTime() > Date.now() ? { kind: "bekliyor" } : { kind: "mesgul" };
    }
    try {
      const r = await build(deps, central, database, tesisId);
      const done = await central.query(
        `UPDATE facility_databases SET status = 'HAZIR', schema_version = $3, ready_at = now(), migrated_at = now(), migration_error = NULL,
                last_error = NULL, next_attempt_at = NULL, claim_owner = NULL, claim_until = NULL, updated_at = now()
          WHERE tesis_id = $1::uuid AND status = 'ISTENDI' AND claim_owner = $2`,
        [tesisId, owner, r.schemaVersion],
      );
      if (done.rowCount === 0) return { kind: "hata", message: "Claim hazırlık sırasında kaybedildi (süre doldu); sonraki tur tamamlar" };
      return { kind: "hazir", database, schemaVersion: r.schemaVersion, applied: r.applied };
    } catch (err) {
      const message = shortError(err);
      await central
        .query(
          `UPDATE facility_databases SET claim_owner = NULL, claim_until = NULL, attempts = attempts + 1, last_error = $3,
                  next_attempt_at = now() + make_interval(secs => LEAST($4::int, (10 * power(2, LEAST(attempts, 10)))::int)), updated_at = now()
            WHERE tesis_id = $1::uuid AND claim_owner = $2`,
          [tesisId, owner, message, BACKOFF_MAX_SECONDS],
        )
        .catch(() => undefined);
      return { kind: "hata", message };
    }
  } finally {
    await central.end().catch(() => undefined);
  }
}

async function build(deps: PrepareDeps, central: Client, database: string, tesisId: string): Promise<{ schemaVersion: string; applied: readonly string[] }> {
  const roles = facilityRoles(database);
  await ensureLoginRole(central, roles.app, deps.key.rolePassword(roles.app));
  await ensureLoginRole(central, roles.sync, deps.key.rolePassword(roles.sync));
  const exists = await central.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
  if (exists.rowCount === 0) {
    try {
      await central.query(`CREATE DATABASE ${ident(database)}`);
    } catch (err) {
      if ((err as { code?: string }).code !== "42P04") throw err; // yarışta "zaten var"
    }
  }
  await restrictConnect(central, database, [roles.app, roles.sync]);
  await markDatabase(central, database, tesisId);
  const facility = client(withDatabase(deps.gocUrl, database));
  await facility.connect();
  try {
    const migrated = await migrateDatabase(facility, deps.migrations ?? readMigrations());
    await alignFacilityGrants(facility, database);
    return { schemaVersion: migrated.schemaVersion, applied: migrated.applied };
  } finally {
    await facility.end().catch(() => undefined);
  }
}

/** Tesis DB'sindeki yetkiler (göçten sonra; göç koşucusu da çağırır). Merkez tabloları burada YETKİSİZ kalır. */
export async function alignFacilityGrants(facility: Client, database: string): Promise<void> {
  const roles = facilityRoles(database);
  await grantAll(facility, roles.app, APP_GRANTS, APP_COLUMN_GRANTS);
  await grantAll(facility, roles.sync, SYNC_GRANTS, SYNC_COLUMN_GRANTS);
  await applySupportRole(facility, database, roles.support);
}

/** Bekleyen hazırlık istekleri (izle döngüsü). */
export async function pendingFacilityDbs(gocUrl: string, limit = 5): Promise<string[]> {
  const c = client(gocUrl);
  await c.connect();
  try {
    const r = await c.query<{ tesis_id: string }>(
      `SELECT tesis_id FROM facility_databases WHERE status = 'ISTENDI' AND (claim_until IS NULL OR claim_until < now())
          AND (next_attempt_at IS NULL OR next_attempt_at <= now()) ORDER BY created_at LIMIT $1`,
      [limit],
    );
    return r.rows.map((x) => x.tesis_id);
  } finally {
    await c.end().catch(() => undefined);
  }
}

export type FacilityMigration =
  | { readonly tesisId: string; readonly database: string; readonly kind: "guncel" | "uygulandi"; readonly applied: readonly string[]; readonly schemaVersion: string; readonly checksumDrift: readonly string[] }
  | { readonly tesisId: string; readonly database: string; readonly kind: "hata"; readonly message: string };

/** Tek HAZIR tesis DB'sine eksik göçler + yetki hizası; sonuç merkez satırına (şema sürümü ya da göç hatası). */
export async function migrateFacilityDb(deps: Pick<PrepareDeps, "gocUrl" | "migrations">, central: Client, tesisId: string): Promise<FacilityMigration> {
  const database = facilityDbName(databaseOf(deps.gocUrl), tesisId);
  try {
    const facility = client(withDatabase(deps.gocUrl, database));
    await facility.connect();
    let r;
    try {
      r = await migrateDatabase(facility, deps.migrations ?? readMigrations());
      await alignFacilityGrants(facility, database);
    } finally {
      await facility.end().catch(() => undefined);
    }
    await central.query(
      `UPDATE facility_databases SET schema_version = $2, migrated_at = now(), migration_error = NULL, updated_at = now() WHERE tesis_id = $1::uuid AND status = 'HAZIR'`,
      [tesisId, r.schemaVersion],
    );
    return { tesisId, database, kind: r.applied.length > 0 ? "uygulandi" : "guncel", applied: r.applied, schemaVersion: r.schemaVersion, checksumDrift: r.checksumDrift };
  } catch (err) {
    const message = shortError(err);
    await central.query(`UPDATE facility_databases SET migration_error = $2, updated_at = now() WHERE tesis_id = $1::uuid`, [tesisId, message]).catch(() => undefined);
    return { tesisId, database, kind: "hata", message };
  }
}

/**
 * Bütün HAZIR tesis DB'leri, TEK TEK (§7): bir tesisin hatası raporlanır, ötekiler sürer; şeması geride kalan
 * tesis sunucuda 503 alır (veri bozulmaz). Merkez bundan ÖNCE Prisma CLI + `db-rolleri` ile göç etmiş olmalıdır.
 */
export async function migrateFacilityDbs(deps: Pick<PrepareDeps, "gocUrl" | "migrations">, only?: readonly string[]): Promise<FacilityMigration[]> {
  const central = client(deps.gocUrl);
  await central.connect();
  try {
    const rows = await central.query<{ tesis_id: string }>(`SELECT tesis_id FROM facility_databases WHERE status = 'HAZIR' ORDER BY created_at, tesis_id`);
    const out: FacilityMigration[] = [];
    for (const row of rows.rows) {
      if (only && !only.includes(row.tesis_id)) continue;
      out.push(await migrateFacilityDb(deps, central, row.tesis_id));
    }
    return out;
  } finally {
    await central.end().catch(() => undefined);
  }
}

/** Merkezin şeması beklenen sürümde mi (göç rolüyle; `goc` komutu önce bunu ister). */
export async function centralSchemaVersion(gocUrl: string): Promise<string | null> {
  const c = client(gocUrl);
  await c.connect();
  try {
    const r = await c.query<{ n: string }>(`SELECT migration_name AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1`);
    return r.rows[0]?.n ?? null;
  } finally {
    await c.end().catch(() => undefined);
  }
}

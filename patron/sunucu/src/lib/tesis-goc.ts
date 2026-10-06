// TESİS GÖÇ KOŞUCUSU — tesis DB'lerine `prisma/migrations` zincirini Prisma CLI'si OLMADAN uygular (CLI süreç
// başına ~220 MB; hazırlayıcının bütçesine sığmaz). Defter Prisma'nın kendisidir: aynı `_prisma_migrations`
// tablosu, aynı sağlama (migration.sql'in SHA-256'sı), aynı advisory kilit ⇒ `prisma migrate status` o DB'yi
// güncel görür. Göç başına tek basit sorgu (çok ifadeli sorgu örtük tx'tir). Yarım kalmış göç (finished_at boş,
// geri alınmamış) varsa DB'ye DOKUNULMAZ — Prisma P3009 davranışı; çözüm `prisma migrate resolve`.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";

/** Prisma şema motorunun göç kilidi (aynı sayı ⇒ Prisma CLI ile koşucu aynı anda göç etmez). */
export const PRISMA_MIGRATE_LOCK = 72707369;

/** Paket kökündeki `prisma/migrations` (kaynaktan `src/lib`, derlemeden `dist` altı — yukarı doğru aranır). */
function findMigrationsDir(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "prisma", "migrations");
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return path.resolve(start, "..", "..", "prisma", "migrations");
}

export const MIGRATIONS_DIR = findMigrationsDir(__dirname);

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export function readMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((d) => existsSync(path.join(dir, d, "migration.sql")))
    .sort()
    .map((name) => {
      const raw = readFileSync(path.join(dir, name, "migration.sql"));
      return { name, sql: raw.toString("utf8"), checksum: createHash("sha256").update(raw).digest("hex") };
    });
}

/** Sunucunun beklediği şema sürümü = son göç dizininin adı. */
export function expectedSchemaVersion(dir: string = MIGRATIONS_DIR): string {
  const all = readMigrations(dir);
  const last = all[all.length - 1];
  if (!last) throw new Error(`Göç dizini boş: ${dir}`);
  return last.name;
}

export class MigrationBlockedError extends Error {
  constructor(readonly migration: string) {
    super(`Yarım kalmış göç: ${migration} — önce \`prisma migrate resolve\``);
    Object.setPrototypeOf(this, MigrationBlockedError.prototype);
  }
}

export class MigrationFailedError extends Error {
  constructor(
    readonly migration: string,
    readonly pgCode: string | undefined,
  ) {
    super(`Göç başarısız: ${migration}${pgCode ? ` (${pgCode})` : ""}`);
    Object.setPrototypeOf(this, MigrationFailedError.prototype);
  }
}

const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum"              VARCHAR(64) NOT NULL,
    "finished_at"           TIMESTAMPTZ,
    "migration_name"        VARCHAR(255) NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        TIMESTAMPTZ,
    "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
)`;

export interface MigrateResult {
  readonly applied: readonly string[];
  readonly schemaVersion: string;
  /** Uygulanmış ama dosyası değişmiş göçler (Prisma da yalnız uyarır). */
  readonly checksumDrift: readonly string[];
}

/** Bağlı DB'ye (göç rolü) eksik göçleri sırayla uygular. Hata → MigrationFailedError; defterde `logs` dolu kalır. */
export async function migrateDatabase(client: Client, migrations: readonly MigrationFile[] = readMigrations()): Promise<MigrateResult> {
  await client.query("SELECT pg_advisory_lock($1)", [PRISMA_MIGRATE_LOCK]);
  try {
    await client.query(LEDGER_DDL);
    const rows = await client.query<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>(
      `SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`,
    );
    const blocked = rows.rows.find((r) => r.finished_at === null && r.rolled_back_at === null);
    if (blocked) throw new MigrationBlockedError(blocked.migration_name);
    const done = new Map(rows.rows.filter((r) => r.finished_at !== null && r.rolled_back_at === null).map((r) => [r.migration_name, r.checksum]));
    const applied: string[] = [];
    const drift: string[] = [];
    for (const m of migrations) {
      const prev = done.get(m.name);
      if (prev !== undefined) {
        if (prev !== m.checksum) drift.push(m.name);
        continue;
      }
      const id = randomUUID();
      await client.query(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, applied_steps_count) VALUES ($1, $2, $3, now(), 0)`, [id, m.checksum, m.name]);
      try {
        await client.query(m.sql);
      } catch (err) {
        const e = err as { code?: string; message?: string };
        await client.query(`UPDATE "_prisma_migrations" SET logs = $2 WHERE id = $1`, [id, `${e.code ?? ""} ${e.message ?? ""}`.trim().slice(0, 4000)]);
        throw new MigrationFailedError(m.name, e.code);
      }
      await client.query(`UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1`, [id]);
      applied.push(m.name);
    }
    const last = migrations[migrations.length - 1];
    if (!last) throw new Error("Göç listesi boş");
    return { applied, schemaVersion: last.name, checksumDrift: drift };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [PRISMA_MIGRATE_LOCK]).catch(() => undefined);
  }
}

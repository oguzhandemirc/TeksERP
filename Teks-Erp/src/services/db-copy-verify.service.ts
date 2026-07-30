// =============================================================================
// Geri yükleme kopyasının doğrulanması
// =============================================================================
// Kopya "hazır" damgasını almadan önce, takas edilse ne olacağını ölçer. İki
// katman: veri toplayan (I/O) + karar veren SAF `evaluateChecks`. Saflık test
// edilebilirlik için: gerçek bir cluster olmadan tüm dallar doğrulanabilsin.
//
// Doğrulama İDEMPOTENT ve YENİDEN KOŞTURULABİLİR — bu yüzden otorite
// `SystemSetting` kaydı değil, taze doğrulamadır. Kayıt yalnız hızlandırıcı.
// =============================================================================

import fs from "fs";
import path from "path";
import { Client } from "pg";
import {
  describePgError,
  liveConn,
  withAdminClient,
  ADMIN_APP_NAME,
} from "./helpers/pg-admin-client";
import { toClientConfig, withDatabase } from "./helpers/pg-conn.helper";

export type CheckStatus = "ok" | "warn" | "fail" | "skipped";

export interface VerificationCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  expected?: string;
  actual?: string;
}

export interface MigrationDiff {
  expected: number;
  applied: number;
  missing: string[];
  extra: string[];
  unfinished: string[];
  rolledBack: string[];
}

export interface TableCount {
  table: string;
  /** `null` = ÖLÇÜLEMEDİ. `0` ile karıştırılmamalı. */
  liveCount: number | null;
  copyCount: number | null;
}

export interface VerificationReport {
  ok: boolean;
  checks: VerificationCheck[];
  migrations: MigrationDiff;
  tables: TableCount[];
  sizeBytes: number | null;
  liveSizeBytes: number | null;
  /** true → takas komutu `prisma migrate deploy` adımını ZORUNLU kılar. */
  needsMigrateDeploy: boolean;
  checkedAt: string;
  durationMs: number;
}

/** Kopyanın canlıyla eşleşmesi gereken yerel ayarları. */
export interface DbLocaleProps {
  encoding: string;
  datcollate: string;
  datctype: string;
  datlocprovider: string;
  datlocale: string | null;
  daticurules: string | null;
  owner: string;
}

export interface EvaluateInput {
  connected: boolean;
  liveLocale: DbLocaleProps | null;
  copyLocale: DbLocaleProps | null;
  /** `pg_db_role_setting.setconfig` — canlı ve kopya için sıralı diziler. */
  liveGuc: string[];
  copyGuc: string[];
  migrations: MigrationDiff;
  tables: TableCount[];
  sizeBytes: number | null;
  liveSizeBytes: number | null;
  restoreStderr: string | null;
}

/**
 * Kritik tablolar: bunlar boşsa geçiş yapılan sistem KULLANILAMAZ hâle gelir
 * (kimse giriş yapamaz, yetki yok, ürün tanımı yok).
 */
const CRITICAL_TABLES = new Set(["users", "permissions"]);

// =============================================================================
// SAF karar fonksiyonu
// =============================================================================

export function evaluateChecks(input: EvaluateInput): Omit<VerificationReport, "checkedAt" | "durationMs"> {
  const checks: VerificationCheck[] = [];
  const push = (c: VerificationCheck): void => void checks.push(c);

  if (!input.connected) {
    push({
      key: "connect", label: "Kopyaya bağlantı", status: "fail",
      detail: "Kopya veritabanına bağlanılamadı.",
    });
    return {
      ok: false, checks, migrations: input.migrations, tables: input.tables,
      sizeBytes: input.sizeBytes, liveSizeBytes: input.liveSizeBytes,
      needsMigrateDeploy: false,
    };
  }
  push({ key: "connect", label: "Kopyaya bağlantı", status: "ok", detail: "Bağlantı kuruldu." });

  // --- Yerel ayarlar: BİREBİR eşleşmeli.
  // Farklıysa takastan sonra ILIKE / mode:'insensitive' (kodda 34 yer) SESSİZCE
  // farklı davranır — bilinen açık bulgu Y-2. Hata vermeyen bir regresyon.
  const l = input.liveLocale;
  const c = input.copyLocale;
  if (!l || !c) {
    push({
      key: "locale", label: "Karakter kümesi ve sıralama (collation)", status: "fail",
      detail: "Yerel ayarlar okunamadı.",
    });
  } else {
    const fields: Array<[keyof DbLocaleProps, string]> = [
      ["encoding", "kodlama"], ["datcollate", "collate"], ["datctype", "ctype"],
      ["datlocprovider", "sağlayıcı"], ["datlocale", "locale"], ["daticurules", "ICU kuralları"],
    ];
    const diffs = fields.filter(([k]) => (l[k] ?? null) !== (c[k] ?? null));
    push(
      diffs.length === 0
        ? {
            key: "locale", label: "Karakter kümesi ve sıralama (collation)", status: "ok",
            detail: `Canlıyla birebir aynı (${l.encoding}, ${l.datcollate}).`,
          }
        : {
            key: "locale", label: "Karakter kümesi ve sıralama (collation)", status: "fail",
            detail:
              `Farklı: ${diffs.map(([k, tr]) => tr).join(", ")}. Takastan sonra Türkçe ARAMA ` +
              `davranışı sessizce değişir (ILIKE farklı katlar) — geçiş yapmayın.`,
            expected: fields.map(([k]) => `${k}=${l[k] ?? "-"}`).join(" "),
            actual: fields.map(([k]) => `${k}=${c[k] ?? "-"}`).join(" "),
          },
    );
    push(
      l.owner === c.owner
        ? { key: "owner", label: "Veritabanı sahibi", status: "ok", detail: l.owner }
        : {
            key: "owner", label: "Veritabanı sahibi", status: "warn",
            detail: "Sahip farklı — yetki hatalarına yol açabilir.",
            expected: l.owner, actual: c.owner,
          },
    );
  }

  // --- Per-DB ayarlar (statement_timeout vb.)
  // `pg_db_role_setting.setdatabase` bir OID kolonu → bu ayarlar rename ile
  // KOPYAYA GEÇMEZ, eski DB'nin OID'sinde kalır. Replay edilmediyse takastan
  // sonra runaway-sorgu koruması SESSİZCE kaybolur.
  const liveGuc = [...input.liveGuc].sort();
  const copyGuc = [...input.copyGuc].sort();
  const gucEqual = liveGuc.length === copyGuc.length && liveGuc.every((v, i) => v === copyGuc[i]);
  push(
    gucEqual
      ? {
          key: "guc", label: "Veritabanı ayarları (statement_timeout vb.)", status: "ok",
          detail: liveGuc.length ? liveGuc.join(", ") : "Canlıda da özel ayar yok.",
        }
      : {
          key: "guc", label: "Veritabanı ayarları (statement_timeout vb.)", status: "fail",
          detail:
            "Kopyada canlının ayarları YOK. Bu ayarlar veritabanı adına değil OID'sine " +
            "bağlıdır, yani takasla taşınmaz — geçerseniz uzun sorgu koruması kaybolur.",
          expected: liveGuc.join(", ") || "(yok)",
          actual: copyGuc.join(", ") || "(yok)",
        },
  );

  // --- Migration kümesi
  // `applied_steps_count` BİLEREK kullanılmıyor: dev'de 130 migration'ın 8'i
  // meşru şekilde 0 (D-23 bulgusu, canlı DB'de doğrulandı) → yanlış alarm üretirdi.
  const m = input.migrations;
  if (m.unfinished.length > 0 || m.rolledBack.length > 0) {
    push({
      key: "migrations", label: "Şema sürümü (migration)", status: "fail",
      detail:
        `Yarım/geri alınmış migration var: ${[...m.unfinished, ...m.rolledBack].slice(0, 3).join(", ")}` +
        `${m.unfinished.length + m.rolledBack.length > 3 ? "…" : ""}. Kopya tutarsız.`,
    });
  } else if (m.missing.length > 0) {
    push({
      key: "migrations", label: "Şema sürümü (migration)", status: "warn",
      detail:
        `Yedek ${m.missing.length} migration ÖNCESİNE ait. Takas komutu bunu ` +
        `\`prisma migrate deploy\` ile tamamlayacak (blokta var).`,
      expected: `${m.expected} migration`, actual: `${m.applied} migration`,
    });
  } else if (m.extra.length > 0) {
    push({
      key: "migrations", label: "Şema sürümü (migration)", status: "warn",
      detail:
        `Yedek koddan YENİ: kopyada olup projede olmayan ${m.extra.length} migration var. ` +
        `\`migrate deploy\` bunu düzeltmez — kodun eski olmadığından emin olun.`,
    });
  } else {
    push({
      key: "migrations", label: "Şema sürümü (migration)", status: "ok",
      detail: `${m.applied} migration, projeyle aynı.`,
    });
  }

  // --- Tablo satır sayıları: amaç EŞİTLİK değil MAKULLÜK.
  // Yedek daha eski olduğu için kopyanın AZ olması NORMALDİR.
  for (const t of input.tables) {
    if (t.copyCount === null) {
      push({
        key: `table:${t.table}`, label: `Tablo: ${t.table}`, status: "warn",
        detail: "Sayılamadı.",
      });
      continue;
    }
    if (CRITICAL_TABLES.has(t.table) && t.copyCount === 0) {
      push({
        key: `table:${t.table}`, label: `Tablo: ${t.table}`, status: "fail",
        detail: "BOŞ. Bu veritabanına geçilirse sisteme kimse giriş yapamaz.",
      });
      continue;
    }
    if (t.liveCount !== null && t.liveCount > 0 && t.copyCount === 0) {
      push({
        key: `table:${t.table}`, label: `Tablo: ${t.table}`, status: "fail",
        detail: `Canlıda ${t.liveCount} kayıt var, kopyada hiç yok — restore eksik olabilir.`,
      });
      continue;
    }
    const more = t.liveCount !== null && t.copyCount > t.liveCount;
    push({
      key: `table:${t.table}`, label: `Tablo: ${t.table}`, status: more ? "warn" : "ok",
      detail: more
        ? `Kopyada canlıdan FAZLA kayıt var (${t.copyCount} > ${t.liveCount}) — yedek canlıdan yeni olabilir.`
        : `${t.copyCount} kayıt (canlı: ${t.liveCount ?? "?"}) — yedek daha eski olduğu için az olması normaldir.`,
    });
  }

  // --- Boyut oranı
  if (input.sizeBytes !== null && input.liveSizeBytes !== null && input.liveSizeBytes > 0) {
    const ratio = input.sizeBytes / input.liveSizeBytes;
    push({
      key: "size", label: "Veritabanı boyutu",
      status: ratio < 0.1 ? "fail" : ratio < 0.5 ? "warn" : "ok",
      detail:
        `Kopya canlının %${Math.round(ratio * 100)}'i kadar` +
        (ratio < 0.1 ? " — restore büyük olasılıkla yarım kaldı." : "."),
    });
  }

  // --- pg_restore stderr
  if (input.restoreStderr && input.restoreStderr.trim()) {
    push({
      key: "restore-stderr", label: "pg_restore uyarıları", status: "warn",
      detail: input.restoreStderr.trim().slice(0, 500),
    });
  }

  return {
    ok: !checks.some((x) => x.status === "fail"),
    checks,
    migrations: m,
    tables: input.tables,
    sizeBytes: input.sizeBytes,
    liveSizeBytes: input.liveSizeBytes,
    needsMigrateDeploy: m.missing.length > 0,
  };
}

// =============================================================================
// Veri toplama
// =============================================================================

const LOCALE_SQL = `
  SELECT pg_encoding_to_char(d.encoding) AS encoding, d.datcollate, d.datctype,
         d.datlocprovider::text AS datlocprovider, d.datlocale, d.daticurules,
         pg_get_userbyid(d.datdba) AS owner
  FROM pg_database d WHERE d.datname = $1`;

/** PG 15/16'da kolon adı `daticulocale`; 17+ `datlocale`. */
const LOCALE_SQL_LEGACY = LOCALE_SQL.replace("d.datlocale", "d.daticulocale AS datlocale");

export async function readLocaleProps(
  client: Client,
  dbName: string,
  serverVersionNum: number,
): Promise<DbLocaleProps | null> {
  const sql = serverVersionNum >= 170000 ? LOCALE_SQL : LOCALE_SQL_LEGACY;
  const r = await client.query<DbLocaleProps>(sql, [dbName]);
  return r.rows[0] ?? null;
}

export async function readDbGuc(client: Client, dbName: string): Promise<string[]> {
  const r = await client.query<{ setconfig: string[] | null }>(
    `SELECT s.setconfig FROM pg_db_role_setting s
     JOIN pg_database d ON d.oid = s.setdatabase
     WHERE d.datname = $1 AND s.setrole = 0`,
    [dbName],
  );
  return r.rows[0]?.setconfig ?? [];
}

/** Projedeki migration dizinleri — şema sürümünün kanonik kaynağı. */
export function readExpectedMigrations(): string[] {
  try {
    return fs
      .readdirSync(path.join(process.cwd(), "prisma", "migrations"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

const COUNTED_TABLES = [
  "users", "permissions", "user_permissions", "items", "customers", "rolls",
  "work_orders", "orders", "shipments", "sacks", "system_settings", "label_templates",
];

async function countTables(client: Client): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (const t of COUNTED_TABLES) {
    try {
      // to_regclass: tablo yoksa (eski şema) sorgu patlamasın.
      const r = await client.query<{ n: string | null }>(
        `SELECT CASE WHEN to_regclass($1) IS NULL THEN NULL
                     ELSE (SELECT count(*) FROM ${`"${t.replace(/"/g, '""')}"`}) END::text AS n`,
        [`public.${t}`],
      );
      const v = r.rows[0]?.n;
      out.set(t, v === null || v === undefined ? null : Number(v));
    } catch {
      out.set(t, null);
    }
  }
  return out;
}

/** Kopyaya bağlanıp doğrulama raporunu üretir. */
export async function verifyCopy(
  copyName: string,
  opts?: { restoreStderr?: string | null },
): Promise<VerificationReport> {
  const started = Date.now();
  const base = liveConn();
  const emptyDiff: MigrationDiff = {
    expected: 0, applied: 0, missing: [], extra: [], unfinished: [], rolledBack: [],
  };
  const fail = (detail: string): VerificationReport => ({
    ok: false,
    checks: [{ key: "connect", label: "Kopyaya bağlantı", status: "fail", detail }],
    migrations: emptyDiff, tables: [], sizeBytes: null, liveSizeBytes: null,
    needsMigrateDeploy: false,
    checkedAt: new Date().toISOString(), durationMs: Date.now() - started,
  });
  if (!base) return fail("DATABASE_URL çözümlenemedi.");

  try {
    // 1) Cluster düzeyi (bakım bağlantısı): locale, GUC, boyutlar.
    const cluster = await withAdminClient(async (client) => {
      const v = await client.query<{ n: string }>(
        `SELECT current_setting('server_version_num') AS n`,
      );
      const vnum = Number(v.rows[0]?.n ?? 0);
      const sizes = await client.query<{ live: string | null; copy: string | null }>(
        `SELECT (SELECT pg_database_size(d.datname)::text FROM pg_database d WHERE d.datname = $1) AS live,
                (SELECT pg_database_size(d.datname)::text FROM pg_database d WHERE d.datname = $2) AS copy`,
        [base.database, copyName],
      );
      return {
        vnum,
        liveLocale: await readLocaleProps(client, base.database, vnum),
        copyLocale: await readLocaleProps(client, copyName, vnum),
        liveGuc: await readDbGuc(client, base.database),
        copyGuc: await readDbGuc(client, copyName),
        liveSizeBytes: sizes.rows[0]?.live ? Number(sizes.rows[0].live) : null,
        sizeBytes: sizes.rows[0]?.copy ? Number(sizes.rows[0].copy) : null,
      };
    });

    // 2) Per-database bilgiler → KOPYAYA doğrudan bağlan (pg_stat_user_tables ve
    //    _prisma_migrations cluster-wide DEĞİL).
    const copyClient = new Client(
      toClientConfig(withDatabase(base, copyName), {
        applicationName: ADMIN_APP_NAME,
        connectTimeoutMs: 5_000,
      }),
    );
    let connected = false;
    let migrations = emptyDiff;
    let copyCounts = new Map<string, number | null>();
    try {
      await copyClient.connect();
      connected = true;
      await copyClient.query("SET statement_timeout = 30000");

      const expected = readExpectedMigrations();
      const rows = await copyClient.query<{
        migration_name: string; finished_at: Date | null; rolled_back_at: Date | null;
      }>(
        `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`,
      ).catch(() => ({ rows: [] as Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }> }));

      const applied = new Set(rows.rows.map((r) => r.migration_name));
      migrations = {
        expected: expected.length,
        applied: applied.size,
        missing: expected.filter((e) => !applied.has(e)),
        extra: [...applied].filter((a) => !expected.includes(a)).sort(),
        unfinished: rows.rows.filter((r) => r.finished_at === null).map((r) => r.migration_name),
        rolledBack: rows.rows.filter((r) => r.rolled_back_at !== null).map((r) => r.migration_name),
      };
      copyCounts = await countTables(copyClient);
    } catch {
      connected = false;
    } finally {
      await copyClient.end().catch(() => {});
    }

    // 3) Canlı tablo sayıları — mevcut Prisma havuzundan (ayrı bağlantı açmaya gerek yok).
    const liveCounts = new Map<string, number | null>();
    for (const t of COUNTED_TABLES) {
      try {
        const r = await prismaCount(t);
        liveCounts.set(t, r);
      } catch {
        liveCounts.set(t, null);
      }
    }

    const tables: TableCount[] = COUNTED_TABLES.map((t) => ({
      table: t,
      liveCount: liveCounts.get(t) ?? null,
      copyCount: copyCounts.get(t) ?? null,
    }));

    const evaluated = evaluateChecks({
      connected,
      liveLocale: cluster.liveLocale,
      copyLocale: cluster.copyLocale,
      liveGuc: cluster.liveGuc,
      copyGuc: cluster.copyGuc,
      migrations,
      tables,
      sizeBytes: cluster.sizeBytes,
      liveSizeBytes: cluster.liveSizeBytes,
      restoreStderr: opts?.restoreStderr ?? null,
    });
    return { ...evaluated, checkedAt: new Date().toISOString(), durationMs: Date.now() - started };
  } catch (err) {
    return fail(describePgError(err));
  }
}

/** Canlı tablo sayımı — mevcut Prisma havuzu üzerinden ham SQL. */
async function prismaCount(table: string): Promise<number | null> {
  const { default: prisma } = await import("../lib/prisma");
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM "${table.replace(/"/g, '""')}"`,
  );
  const n = rows[0]?.n;
  return n === undefined ? null : Number(n);
}

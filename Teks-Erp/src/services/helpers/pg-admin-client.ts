// =============================================================================
// Bakım veritabanı bağlantısı — kısa ömürlü, HAVUZSUZ
// =============================================================================
// Geri yükleme kopyası akışı, uygulama veritabanının DIŞINDA çalışmak zorunda:
// `CREATE DATABASE` / `DROP DATABASE` / `ALTER DATABASE` bağlı olduğunuz
// veritabanı üzerinde yapılamaz. Repoda bugüne kadar app DB'si dışına bağlanan
// hiç kod yoktu — bu katman o boşluğu dolduruyor.
//
// **HAVUZ YOK (pazarlık dışı).** `pg.Pool` idle bağlantı tutar; kopya
// veritabanına açık kalan TEK bir bağlantı, takas sırasındaki ikinci
// `ALTER DATABASE ... RENAME`'i düşürür — yani doğrudan "backend hiç açılmaz"
// senaryosunu üretir. Her çağrı kendi Client'ını açar ve `finally`'de kapatır.
// =============================================================================

import { Client } from "pg";
import {
  parseDatabaseUrl,
  toClientConfig,
  withDatabase,
  type PgConn,
} from "./pg-conn.helper";

/**
 * Bakım bağlantısının `application_name`'i — LOAD-BEARING.
 * Takas komutunun ön kontrolü, "kopya veritabanına bağlı kalan oturum" gördüğünde
 * bunun backend'in sızmış doğrulama bağlantısı mı yoksa operatörün pgAdmin'i mi
 * olduğunu bununla ayırt eder. İkisinin tedavisi farklı.
 */
export const ADMIN_APP_NAME = "teks-erp-dbcopy";

const CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

/** Yedek/DDL için yükseltilmiş kimlik — `BACKUP_PG_USER` çifti (üçüncü env açılmaz). */
function adminOverride(): { user?: string | undefined; password?: string | undefined } {
  return { user: process.env.BACKUP_PG_USER, password: process.env.BACKUP_PG_PASSWORD };
}

/** Uygulama veritabanının bağlantı bilgisi (yükseltilmiş kimlikle). */
export function liveConn(): PgConn | null {
  return parseDatabaseUrl(process.env.DATABASE_URL, adminOverride());
}

/** Bakım veritabanı adı — `CREATE/DROP/ALTER DATABASE` buradan çalıştırılır. */
export function maintenanceDbName(): string {
  return process.env.PG_MAINTENANCE_DB || "postgres";
}

export class PgAdminUnavailable extends Error {}

/**
 * Kısa ömürlü bir Client açar, `fn`'i çalıştırır, HER DURUMDA kapatır.
 *
 * `statementTimeoutMs`: bakım veritabanında per-DB `statement_timeout` ayarı
 * YOKTUR (o ayar uygulama DB'sinin OID'sine bağlı) → varsayılan **sonsuzdur**.
 * Bu yüzden açıkça set ediyoruz. DDL için `0` geçilir (`CREATE DATABASE` büyük
 * template'te dakikalar sürebilir); sorgular için 30sn.
 */
export async function withAdminClient<T>(
  fn: (client: Client) => Promise<T>,
  opts?: { database?: string; statementTimeoutMs?: number },
): Promise<T> {
  const base = liveConn();
  if (!base) {
    throw new PgAdminUnavailable("DATABASE_URL çözümlenemedi — yönetim bağlantısı kurulamaz.");
  }
  const target = withDatabase(base, opts?.database ?? maintenanceDbName());
  const client = new Client(
    toClientConfig(target, {
      applicationName: ADMIN_APP_NAME,
      connectTimeoutMs: CONNECT_TIMEOUT_MS,
    }),
  );
  await client.connect();
  try {
    const timeout = opts?.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
    await client.query(`SET statement_timeout = ${Number(timeout)}`);
    return await fn(client);
  } finally {
    // Sızan bağlantı = takasın ikinci rename'i düşer. Hata yutulur ama kapatma atlanmaz.
    await client.end().catch(() => {});
  }
}

// =============================================================================
// Yetenek yoklaması — fail-closed
// =============================================================================

export interface AdminCapability {
  user: string;
  isSuperuser: boolean;
  canCreateDb: boolean;
  /** Özellik kullanılabilir mi (superuser VEYA CREATEDB). */
  enabled: boolean;
  /** Kapalıysa operatöre verilecek TALİMAT (ham PG hatası değil). */
  reason: string | null;
  serverVersionNum: number;
}

export async function probeCapabilities(): Promise<AdminCapability | { error: string }> {
  try {
    return await withAdminClient(async (c) => {
      const r = await c.query<{
        usename: string;
        rolsuper: boolean;
        rolcreatedb: boolean;
        vnum: string;
      }>(
        `SELECT current_user AS usename, r.rolsuper, r.rolcreatedb,
                current_setting('server_version_num') AS vnum
         FROM pg_roles r WHERE r.rolname = current_user`,
      );
      const row = r.rows[0];
      if (!row) return { error: "Rol bilgisi okunamadı." } as { error: string };
      const enabled = row.rolsuper || row.rolcreatedb;
      return {
        user: row.usename,
        isSuperuser: row.rolsuper,
        canCreateDb: row.rolcreatedb,
        enabled,
        reason: enabled
          ? null
          : `"${row.usename}" kullanıcısının veritabanı oluşturma yetkisi yok. ` +
            `Sunucuda şunu çalıştırın: ALTER ROLE "${row.usename}" CREATEDB;  ` +
            `(ya da ecosystem.config.js'te BACKUP_PG_USER=postgres verin.)`,
        serverVersionNum: Number(row.vnum),
      } as AdminCapability;
    });
  } catch (err) {
    return { error: describePgError(err) };
  }
}

// =============================================================================
// Hata çevirisi — ham SQLSTATE yerine ne yapılacağını söyle
// =============================================================================

export function describePgError(err: unknown): string {
  const e = err as { code?: string; message?: string; detail?: string } | undefined;
  const code = e?.code;
  const raw = e?.message ?? String(err);
  switch (code) {
    case "42P04":
      return `Bu adda bir veritabanı zaten var. (${raw})`;
    case "3D000":
      return `Veritabanı bulunamadı. (${raw})`;
    case "55006":
      return `Veritabanı kullanımda — açık bağlantılar kapatılmadan bu işlem yapılamaz. (${raw})`;
    case "42501":
      return `Yetki yok. BACKUP_PG_USER superuser olmalı ya da gerekli yetkiye sahip olmalı. (${raw})`;
    case "28P01":
      return `Kimlik doğrulama başarısız — BACKUP_PG_PASSWORD yanlış olabilir. (${raw})`;
    case "3D001":
      return `Şema bulunamadı. (${raw})`;
    case "53100":
      return `DİSK DOLU — PostgreSQL yazamıyor. Bu canlı veritabanını da durdurabilir. (${raw})`;
    default:
      return raw;
  }
}

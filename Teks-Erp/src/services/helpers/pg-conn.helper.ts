// =============================================================================
// PostgreSQL bağlantı bilgisi — SAF (env/fs/prisma YOK)
// =============================================================================
// `backup.service.ts`'ten ayıklandı. Orada `parseDatabaseUrl` modül-içiydi ve
// `BACKUP_PG_USER`'ı modül-yükleme anında `const`'a alıyordu; bu yüzden
// `scripts/test_backup.ts` dinamik import'a mecburdu. Burada `raw` ve `override`
// ARGÜMAN → statik import'la, env'e dokunmadan test edilebilir.
//
// Geri yükleme kopyası akışı da aynı çözümlemeye ihtiyaç duyuyor ("aynı sunucu,
// farklı DB adı") — iki yerde kopyalamak yerine tek kaynak.
// =============================================================================

export interface PgConn {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

/** Yükseltilmiş DB kimliği (yedek/DDL için). Bkz. aşağıdaki şifre eşleştirme notu. */
export interface PgUserOverride {
  user?: string | undefined;
  password?: string | undefined;
}

/**
 * `DATABASE_URL`'i çözer. Çözülemezse `null`.
 *
 * **Şifre eşleştirme kuralı (load-bearing):** `override.user` verildiyse şifre de
 * override'dan alınır (`?? ""`), URL'deki şifre KULLANILMAZ. Aksi halde `postgres`
 * kullanıcısıyla uygulama kullanıcısının şifresi denenir ve hata "wrong password"
 * olarak görünür — sebebi hiçbir yerde yazmaz. Bu kural kopyalanmamalı; tek yer burası.
 */
export function parseDatabaseUrl(
  raw: string | undefined,
  override?: PgUserOverride,
): PgConn | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (!database) return null;
    const overrideUser = override?.user;
    return {
      host: u.hostname || "127.0.0.1",
      port: u.port || "5432",
      user: overrideUser || decodeURIComponent(u.username),
      password: overrideUser ? (override?.password ?? "") : decodeURIComponent(u.password),
      database,
    };
  } catch {
    return null;
  }
}

/** Aynı sunucu/kimlik, farklı veritabanı. */
export function withDatabase(conn: PgConn, database: string): PgConn {
  return { ...conn, database };
}

/**
 * `pg.Client` yapılandırması.
 *
 * Bilinçli olarak **connection string ÜRETMİYORUZ**: `pg` ayrık alan kabul ediyor
 * ve URL kurmak `@`, `#`, `/`, `%` içeren şifrelerde yüzde-kodlama hatası yüzeyi
 * açar. Repoda bugün hiçbir yerde URL kurulmuyor; o kapıyı hiç aralamıyoruz.
 */
export function toClientConfig(
  conn: PgConn,
  opts?: { applicationName?: string; connectTimeoutMs?: number },
): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  application_name?: string;
  connectionTimeoutMillis?: number;
} {
  return {
    host: conn.host,
    port: Number(conn.port),
    user: conn.user,
    password: conn.password,
    database: conn.database,
    ...(opts?.applicationName ? { application_name: opts.applicationName } : {}),
    ...(opts?.connectTimeoutMs ? { connectionTimeoutMillis: opts.connectTimeoutMs } : {}),
  };
}

/** `pg_dump`/`pg_restore`/`psql` ortak bağlantı argümanları. */
export function pgToolArgs(conn: PgConn): string[] {
  return ["-h", conn.host, "-p", conn.port, "-U", conn.user, "-d", conn.database];
}

/**
 * SQL identifier kaçırma (`"` doubling). DDL parametrelenemez — `CREATE DATABASE`,
 * `ALTER DATABASE`, `DROP DATABASE` hepsi identifier'ı literal olarak ister, bu
 * yüzden tek savunma budur. Kullanıcıdan gelen ad ASLA doğrudan interpolate edilmez;
 * çağıran ayrıca allowlist uygular.
 */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** SQL string literal kaçırma (`'` doubling). */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

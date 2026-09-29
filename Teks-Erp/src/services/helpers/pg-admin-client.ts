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

/** Yedek/DDL kimliği — `BACKUP_PG_USER` çifti (bakım rolü; üçüncü env açılmaz). */
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
// Yetenek yoklaması — fail-closed, ROL-BAĞIMSIZ
// =============================================================================
// Süper kullanıcı ŞART DEĞİL. Kopya/yedek/takas zincirinin ölçülmüş yetki
// ihtiyacı (PG 16): CREATEDB + canlı DB sahibinin rolüne üyelik (SET + INHERIT:
// `CREATE DATABASE … OWNER`, sahipliği koruyan `pg_restore`, `DROP … WITH (FORCE)`,
// `RENAME`, sahip oturumlarını `pg_terminate_backend`) + canlıdaki özel DB ayarları
// (`teks.*`) için `GRANT SET ON PARAMETER`. Kurulumu `deploy/bakim-rolu.ps1` yapar.
// Eksik ön koşul kopya ANINDA değil burada söylenir (felaket günü keşfedilmesin).

export interface AdminCapability {
  user: string;
  isSuperuser: boolean;
  canCreateDb: boolean;
  /** Canlı veritabanının sahibi (`pg_database.datdba`); okunamadıysa null. */
  liveDbOwner: string | null;
  /** Sahip rolü adına işlem yapabilir mi (SET ROLE + miras) — süper kullanıcıda true. */
  actsAsOwner: boolean;
  /** Canlıdaki, bu kimliğin kopyaya yeniden kuramayacağı DB düzeyi ayarlar. */
  blockedParameters: string[];
  /** Canlıda sahibine erişilemeyen nesnelerin sahipleri; null = ölçülemedi. */
  foreignOwners: string[] | null;
  /** Özellik kullanılabilir mi (bkz. `evaluateAdminCapability`). */
  enabled: boolean;
  /** Kapalıysa operatöre verilecek TALİMAT (ham PG hatası değil). */
  reason: string | null;
  serverVersionNum: number;
}

export type AdminCapabilityFacts = Omit<AdminCapability, "enabled" | "reason" | "serverVersionNum"> & {
  ownerIsSuperuser: boolean;
};

function sqlIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** SAF karar: olgulardan `enabled` + talimat. Sıra, operatörün düzelteceği sıradır. */
export function evaluateAdminCapability(f: AdminCapabilityFacts): { enabled: boolean; reason: string | null } {
  if (f.isSuperuser) return { enabled: true, reason: null };
  const u = sqlIdent(f.user);
  if (!f.canCreateDb) {
    return {
      enabled: false,
      reason:
        `"${f.user}" kullanıcısının veritabanı oluşturma yetkisi yok. Süper kullanıcı OLMAYAN ` +
        `bir bakım rolü kurun (sunucuda: bakim-rolu.ps1) ya da: ALTER ROLE ${u} CREATEDB;`,
    };
  }
  if (!f.liveDbOwner) {
    return { enabled: false, reason: "Canlı veritabanının sahibi okunamadı — kopya kurulamaz." };
  }
  const o = sqlIdent(f.liveDbOwner);
  if (f.ownerIsSuperuser) {
    return {
      enabled: false,
      reason:
        `Canlı veritabanının sahibi "${f.liveDbOwner}" bir süper kullanıcı; süper olmayan bir rol ` +
        `onun adına kopya kuramaz. Sahipliği uygulama rolüne devredin (ALTER DATABASE … OWNER TO …).`,
    };
  }
  if (!f.actsAsOwner) {
    return {
      enabled: false,
      reason:
        `"${f.user}" canlı veritabanının sahibi "${f.liveDbOwner}" adına işlem yapamıyor. ` +
        `Sunucuda: GRANT ${o} TO ${u};`,
    };
  }
  if (f.blockedParameters.length > 0) {
    return {
      enabled: false,
      reason:
        `Canlı veritabanının ${f.blockedParameters.join(", ")} ayarı kopyaya aktarılamaz (yetki yok) — ` +
        `kopya doğrulamadan geçemez. Sunucuda: ` +
        f.blockedParameters.map((p) => `GRANT SET ON PARAMETER ${p} TO ${u};`).join(" "),
    };
  }
  if (f.foreignOwners && f.foreignOwners.length > 0) {
    return {
      enabled: false,
      reason:
        `Canlı veritabanında "${f.user}" rolünün erişemediği nesneler var (sahipleri: ` +
        `${f.foreignOwners.join(", ")}) — yedek ve kopya bu nesnelerde düşer. Sahipliği ` +
        `"${f.liveDbOwner}" rolüne devredin.`,
    };
  }
  return { enabled: true, reason: null };
}

/** Canlıda sahibine erişilemeyen (eklenti üyesi olmayan) şema nesnelerinin sahipleri. */
const FOREIGN_OWNERS_SQL = `
  WITH own AS (
    SELECT c.relowner AS owner FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast|temp)'
       AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e')
    UNION ALL
    SELECT p.proowner FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_proc'::regclass AND e.objid = p.oid AND e.deptype = 'e')
    UNION ALL
    SELECT t.typowner FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND t.typtype IN ('e', 'd', 'r', 'm')
       AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_type'::regclass AND e.objid = t.oid AND e.deptype = 'e')
    UNION ALL
    SELECT n.nspowner FROM pg_namespace n
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'public') AND n.nspname !~ '^pg_'
  )
  SELECT DISTINCT pg_get_userbyid(owner) AS owner FROM own
   WHERE NOT pg_has_role(current_user, owner, 'USAGE')
   ORDER BY 1`;

export async function probeCapabilities(): Promise<AdminCapability | { error: string }> {
  const liveDb = liveConn()?.database ?? null;
  try {
    const base = await withAdminClient(async (c) => {
      const r = await c.query<{
        usename: string;
        rolsuper: boolean;
        rolcreatedb: boolean;
        vnum: string;
        owner: string | null;
        owner_super: boolean | null;
        setconfig: string[] | null;
      }>(
        `SELECT current_user AS usename, r.rolsuper, r.rolcreatedb,
                current_setting('server_version_num') AS vnum,
                o.rolname AS owner, o.rolsuper AS owner_super, s.setconfig
         FROM pg_roles r
         LEFT JOIN pg_database d ON d.datname = $1
         LEFT JOIN pg_roles o ON o.oid = d.datdba
         LEFT JOIN pg_db_role_setting s ON s.setdatabase = d.oid AND s.setrole = 0
         WHERE r.rolname = current_user`,
        [liveDb],
      );
      const row = r.rows[0];
      if (!row) return null;
      const vnum = Number(row.vnum);
      const facts: AdminCapabilityFacts = {
        user: row.usename,
        isSuperuser: row.rolsuper,
        canCreateDb: row.rolcreatedb,
        liveDbOwner: row.owner,
        ownerIsSuperuser: row.owner_super === true,
        actsAsOwner: row.rolsuper,
        blockedParameters: [],
        foreignOwners: row.rolsuper ? [] : null,
      };
      if (!row.rolsuper && row.owner) {
        // PG 16 ayrı SET seçeneği getirdi; öncesinde üyelik SET ROLE'u kapsar.
        const setPriv = vnum >= 160000 ? "SET" : "MEMBER";
        const m = await c.query<{ set_ok: boolean; usage_ok: boolean }>(
          `SELECT pg_has_role(current_user, $1::name, $2) AS set_ok,
                  pg_has_role(current_user, $1::name, 'USAGE') AS usage_ok`,
          [row.owner, setPriv],
        );
        facts.actsAsOwner = !!m.rows[0]?.set_ok && !!m.rows[0]?.usage_ok;
        facts.blockedParameters = await readBlockedParameters(c, row.setconfig ?? [], vnum);
      }
      return { facts, vnum };
    });
    if (!base) return { error: "Rol bilgisi okunamadı." };
    const { facts, vnum } = base;
    if (!facts.isSuperuser && facts.actsAsOwner && liveDb) {
      facts.foreignOwners = await withAdminClient(
        async (c) => (await c.query<{ owner: string }>(FOREIGN_OWNERS_SQL)).rows.map((x) => x.owner),
        { database: liveDb },
      ).catch(() => null);
    }
    return {
      user: facts.user,
      isSuperuser: facts.isSuperuser,
      canCreateDb: facts.canCreateDb,
      liveDbOwner: facts.liveDbOwner,
      actsAsOwner: facts.actsAsOwner,
      blockedParameters: facts.blockedParameters,
      foreignOwners: facts.foreignOwners,
      ...evaluateAdminCapability(facts),
      serverVersionNum: vnum,
    };
  } catch (err) {
    return { error: describePgError(err) };
  }
}

/**
 * Canlının DB düzeyi ayarlarından bu kimliğin kopyaya yeniden KURAMAYACAKLARI.
 * Kullanıcı bağlamlı (`context='user'`) ayar herkesçe kurulur; yer tutucu (`teks.*`)
 * ve süper kullanıcı bağlamlı ayar `GRANT SET ON PARAMETER` ister (PG 15+).
 * PG 15 öncesinde yetki sorulamaz → ölçülemedi, engellenmez.
 */
async function readBlockedParameters(c: Client, setconfig: string[], vnum: number): Promise<string[]> {
  const keys = setconfig.map((kv) => kv.slice(0, Math.max(0, kv.indexOf("=")))).filter(Boolean);
  if (keys.length === 0 || vnum < 150000) return [];
  const ctx = await c.query<{ name: string; context: string }>(
    `SELECT name, context FROM pg_settings WHERE name = ANY($1::text[])`,
    [keys.map((k) => k.toLowerCase())],
  );
  const userSettable = new Set(ctx.rows.filter((x) => x.context === "user").map((x) => x.name));
  const blocked: string[] = [];
  for (const key of keys) {
    if (userSettable.has(key.toLowerCase())) continue;
    const p = await c.query<{ ok: boolean }>(`SELECT has_parameter_privilege($1, 'SET') AS ok`, [key]);
    if (!p.rows[0]?.ok) blocked.push(key);
  }
  return blocked;
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
      return `Yetki yok. Bakım kimliği (BACKUP_PG_USER) canlı veritabanının sahibi adına işlem yapabilmeli — süper kullanıcı gerekmez (CREATEDB + sahip rolüne üyelik; bakim-rolu.ps1). (${raw})`;
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

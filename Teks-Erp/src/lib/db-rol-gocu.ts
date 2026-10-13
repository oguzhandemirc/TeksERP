// =============================================================================
// db-rol-gocu — G4: uygulama DB rolünü tablo sahibinden ayırır (dist/tools/db-rol-gocu.cjs)
// =============================================================================
// Kullanım (bağlantı: DATABASE_URL = SAHİP rolü; Docker'da POSTGRES_USER):
//   (argümansız)        KURU: ölçüm + uygulanacak statementsin listesi, hiçbir şey değişmez
//   --uygula            tek transaction'da uygular, sonra uygulama rolüyle bağlanıp doğrular
//   --url-yaz           (--uygula ile) uygulama rolünün URL'ini YALNIZ stdout'a yazar — entrypoint yakalar
//   --rol <ad>          uygulama rolünün adı (varsayılan: <sahip>_uygulama)
//   --okuma-rol <ad>    G5 yalnız-okuma rolünün adı (varsayılan: <sahip>_okuma; kural/liste `okuma-rolu.ts`)
// Çıkış: 0 tamam · 1 hata (bağlantı/PG/doğrulama) · 2 uygulanamaz (sahip değil, şema yok)
// Uygulama rolü: LOGIN, süper/CREATEDB/CREATEROLE değil, hiçbir role üye değil, hiçbir nesnenin
// sahibi değil; tablolarda DML, system_logs'ta yalnız SELECT+INSERT, arşivde yalnız SELECT
// (arşivleme/budama SECURITY DEFINER fonksiyonlarla). Her koşum idempotent: bozulmuş durumu onarır.
// Parola sahip parolasından türetilir (HMAC) — yeni sır dosyası yok; psql'e SCRAM doğrulayıcısı
// gider (düz parola sunucu günlüğüne düşmez). Parola/URL hiçbir koşulda stderr'e basılmaz.
// =============================================================================

import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { Client } from "pg";
import { AUDIT_TAMPER_SQL } from "./audit-koruma-sql";
import { READ_ONLY_HIDDEN_COLUMNS, READ_ONLY_HIDDEN_TABLES, readOnlyCatalog, readOnlyPlan } from "./okuma-rolu";

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_NOT_APPLICABLE = 2;

const PASSWORD_LABEL = "tekserp/uygulama-rolu/v1:";
const ROLE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

export class NotApplicable extends Error {}

export function deriveAppPassword(ownerPassword: string, rol: string): string {
  return createHmac("sha256", ownerPassword).update(PASSWORD_LABEL + rol).digest("hex");
}

/** PG `SCRAM-SHA-256$iter:salt$StoredKey:ServerKey` (RFC 5802/7677) — `bakim-rolu.ps1` ScramDogrulayici ikizi. */
export function scramVerifier(parola: string, salt: Buffer = randomBytes(16), iter = 4096): string {
  const salted = pbkdf2Sync(parola, salt, iter, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iter}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

const id = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** libpq/pg `schema=` Prisma parametresini tanımaz. */
function pgUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("schema");
  return u.toString();
}

export interface RoleState {
  sahip: string;
  db: string;
  roleExists: boolean;
  /** Uygulama rolünün bu DB'de sahip olduğu nesne sayısı (onarılacak). */
  ownedObjects: number;
  /** Uygulama rolünün üye olduğu roller (onarılacak). */
  memberships: string[];
  /** Uygulama rolü bugün audit'i kurcalayabilir mi (yalnız rol varken anlamlı). */
  canTamper: boolean;
}

export async function measureRoleState(c: Client, rol: string): Promise<RoleState> {
  const r = await c.query(`
    SELECT current_user AS sahip, current_database() AS db, s.rolsuper, s.rolcreaterole,
           to_regclass('public.system_logs') IS NOT NULL AS sl,
           to_regclass('public.system_log_archives') IS NOT NULL AS sla
    FROM pg_roles s WHERE s.rolname = current_user`);
  const o = r.rows[0];
  if (!o.sl || !o.sla) throw new NotApplicable("system_logs/system_log_archives yok (göç uygulanmamış)");
  if (o.sahip === rol) throw new NotApplicable(`uygulama rolü sahip rolüyle aynı ad (${rol})`);
  const ownership = await c.query(
    `SELECT pg_has_role(current_user, relowner, 'MEMBER') AS m FROM pg_class
     WHERE oid IN ('public.system_logs'::regclass, 'public.system_log_archives'::regclass)`);
  const isOwner = ownership.rows.every((x: { m: boolean }) => x.m);
  if (!o.rolsuper && !(isOwner && o.rolcreaterole)) {
    throw new NotApplicable(`bağlı rol (${o.sahip}) süper kullanıcı ya da audit tablolarının CREATEROLE'lü sahibi değil`);
  }
  const rv = await c.query(`SELECT oid FROM pg_roles WHERE rolname = $1`, [rol]);
  if (rv.rowCount === 0) {
    return { sahip: o.sahip, db: o.db, roleExists: false, ownedObjects: 0, memberships: [], canTamper: false };
  }
  const oid = rv.rows[0].oid;
  const n = await c.query(
    `SELECT (SELECT count(*) FROM pg_class WHERE relowner = $1)
          + (SELECT count(*) FROM pg_proc WHERE proowner = $1)
          + (SELECT count(*) FROM pg_namespace WHERE nspowner = $1)
          + (SELECT count(*) FROM pg_type WHERE typowner = $1 AND typrelid = 0)
          + (SELECT count(*) FROM pg_database WHERE datdba = $1) AS n`, [oid]);
  const u = await c.query(
    `SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE m.member = $1 ORDER BY 1`, [oid]);
  const k = await c.query(
    `SELECT a.rolsuper
       OR pg_has_role($1, (SELECT relowner FROM pg_class WHERE oid = 'public.system_logs'::regclass), 'MEMBER')
       OR pg_has_role($1, (SELECT relowner FROM pg_class WHERE oid = 'public.system_log_archives'::regclass), 'MEMBER')
       OR has_table_privilege($1, 'public.system_logs', 'UPDATE, DELETE, TRUNCATE')
       OR has_table_privilege($1, 'public.system_log_archives', 'UPDATE, DELETE, TRUNCATE') AS t
     FROM pg_roles a WHERE a.rolname = $1`, [rol]);
  return {
    sahip: o.sahip, db: o.db, roleExists: true, ownedObjects: Number(n.rows[0].n),
    memberships: u.rows.map((x: { rolname: string }) => x.rolname), canTamper: Boolean(k.rows[0].t),
  };
}

/** Uygulanacak statements, sırasıyla. `verifier` yoksa parola yerine `<SCRAM>` yazılır (KURU çıktısı). */
export function plan(o: RoleState, rol: string, verifier?: string): string[] {
  const R = id(rol);
  const S = id(o.sahip);
  const out: string[] = [];
  if (!o.roleExists) out.push(`CREATE ROLE ${R}`);
  out.push(`ALTER ROLE ${R} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT `
    + `CONNECTION LIMIT -1 PASSWORD ${verifier ? lit(verifier) : "'<SCRAM>'"}`);
  for (const u of o.memberships) out.push(`REVOKE ${id(u)} FROM ${R}`);
  if (o.roleExists) out.push(`REASSIGN OWNED BY ${R} TO ${S}`);
  out.push(
    `GRANT CONNECT, TEMPORARY ON DATABASE ${id(o.db)} TO ${R}`,
    `GRANT USAGE ON SCHEMA public TO ${R}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${R}`,
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${R}`,
    `GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO ${R}`,
    // Audit: yalnız SELECT+INSERT (arşiv yalnız SELECT); PUBLIC üzerinden dolanma da kapanır.
    `REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "system_logs", "system_log_archives" FROM ${R}, PUBLIC`,
    `REVOKE INSERT ON "system_log_archives" FROM ${R}, PUBLIC`,
    // Sonraki göçlerin (sahip koşar) yarattığı nesneler kendiliğinden erişilir olur.
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${S} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${R}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${S} IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${R}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${S} IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${R}`,
  );
  return out;
}

export interface MigrateOptions { ownerUrl: string; rol?: string; readRole?: string; uygula: boolean; log?: (s: string) => void }
export interface MigrateResult {
  kod: number; appUrl?: string; state?: RoleState; statements?: string[];
  /** G5 okuma rolü ifadeleri ve sonucu ("ready" · "closed" — okuma rolü düşerse uygulama rolü etkilenmez). */
  readStatements?: string[]; readResult?: "ready" | "closed";
}

/** G5 — okuma rolünün var olup olmadığı ve üyelikleri (sahip bağlantısıyla). */
async function readRoleState(c: Client, readRoleName: string): Promise<{ exists: boolean; memberships: string[] }> {
  const r = await c.query(`SELECT oid FROM pg_roles WHERE rolname = $1`, [readRoleName]);
  if (r.rowCount === 0) return { exists: false, memberships: [] };
  const u = await c.query(
    `SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE m.member = $1 ORDER BY 1`, [r.rows[0].oid]);
  return { exists: true, memberships: u.rows.map((x: { rolname: string }) => x.rolname) };
}

/** G5 — okuma rolü yazamaz, sır okuyamaz, definer/advisory fonksiyon çağıramaz (sahip bağlantısıyla ölçülür). */
export async function readRoleViolations(c: Client, readRoleName: string): Promise<string[]> {
  const r = await c.query(`
    SELECT 'yazma:' || c.relname AS i FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S')
       AND (has_table_privilege($1, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
            OR (c.relkind = 'S' AND has_sequence_privilege($1, c.oid, 'USAGE, UPDATE')))
    UNION ALL
    SELECT 'definer:' || p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege($1, p.oid, 'EXECUTE')
    UNION ALL
    SELECT 'advisory:' || p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'pg_catalog' AND p.proname ~ '^pg_(try_)?advisory_' AND has_function_privilege($1, p.oid, 'EXECUTE')
    UNION ALL
    SELECT 'ozellik' FROM pg_roles a WHERE a.rolname = $1
     AND (a.rolsuper OR a.rolcreatedb OR a.rolcreaterole OR a.rolreplication OR a.rolbypassrls
          OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = a.oid))
    UNION ALL
    SELECT 'sema-create' WHERE has_schema_privilege($1, 'public', 'CREATE')`, [readRoleName]);
  const out = r.rows.map((x: { i: string }) => x.i);
  for (const t of READ_ONLY_HIDDEN_TABLES) {
    const v = await c.query(`SELECT to_regclass($2) IS NOT NULL AND has_table_privilege($1, to_regclass($2), 'SELECT')
      OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass($2) AND attnum > 0 AND NOT attisdropped
                 AND has_column_privilege($1, to_regclass($2), attnum, 'SELECT')) AS v`, [readRoleName, `public.${t}`]);
    if (v.rows[0].v) out.push(`sir-tablo:${t}`);
  }
  for (const [t, columns] of Object.entries(READ_ONLY_HIDDEN_COLUMNS)) {
    for (const k of columns) {
      const v = await c.query(`SELECT a.attnum IS NOT NULL AND has_column_privilege($1, to_regclass($2), a.attnum, 'SELECT') AS v
        FROM (SELECT 1) x LEFT JOIN pg_attribute a ON a.attrelid = to_regclass($2) AND a.attname = $3 AND NOT a.attisdropped`,
      [readRoleName, `public.${t}`, k]);
      if (v.rows[0].v) out.push(`sir-kolon:${t}.${k}`);
    }
  }
  return out;
}

export async function runRoleMigration(s: MigrateOptions): Promise<MigrateResult> {
  const log = s.log ?? ((m: string) => process.stderr.write(m + "\n"));
  const url = new URL(s.ownerUrl);
  const ownerPassword = decodeURIComponent(url.password);
  const rol = s.rol ?? `${decodeURIComponent(url.username)}_uygulama`;
  const readRoleName = s.readRole ?? `${decodeURIComponent(url.username)}_okuma`;
  if (!ROLE_NAME_PATTERN.test(rol)) { log(`X Gecersiz rol adi: ${rol}`); return { kod: EXIT_NOT_APPLICABLE }; }
  if (!ROLE_NAME_PATTERN.test(readRoleName) || readRoleName === rol) { log(`X Gecersiz okuma rolu adi: ${readRoleName}`); return { kod: EXIT_NOT_APPLICABLE }; }
  if (!ownerPassword) { log("X Sahip URL'inde parola yok (uygulama parolasi turetilemez)."); return { kod: EXIT_NOT_APPLICABLE }; }

  const c = new Client({ connectionString: pgUrl(s.ownerUrl) });
  let state: RoleState;
  let statements: string[];
  let readStatements: string[];
  try {
    await c.connect();
    state = await measureRoleState(c, rol);
    if (state.sahip === readRoleName) throw new NotApplicable(`okuma rolu sahip rolüyle aynı ad (${readRoleName})`);
    statements = plan(state, rol);
    const rs = await readRoleState(c, readRoleName);
    readStatements = readOnlyPlan({
      owner: state.sahip, db: state.db, appRole: rol, role: readRoleName, roleExists: rs.exists, memberships: rs.memberships,
      catalog: await readOnlyCatalog((q) => c.query(q)),
    });
    log(`Hedef: ${state.db} · sahip: ${state.sahip} · uygulama rolu: ${rol} (${state.roleExists ? "var" : "yok"})`);
    if (state.roleExists) {
      log(`  state: audit kurcalayabilir=${state.canTamper} · sahip oldugu nesne=${state.ownedObjects}`
        + ` · uyelik=${state.memberships.join(",") || "-"}`);
    }
    for (const q of statements) log(`  ${q};`);
    log(`Okuma rolu: ${readRoleName} (${rs.exists ? "var" : "yok"}) · ${readStatements.length} ifade`);
    if (!s.uygula) for (const q of readStatements) log(`  ${q};`);
    if (!s.uygula) {
      log("KURU: hicbir sey degismedi. Uygulamak icin --uygula.");
      return { kod: EXIT_OK, state, statements, readStatements };
    }
    const parola = deriveAppPassword(ownerPassword, rol);
    let readResult: "ready" | "closed" = "ready";
    await c.query("BEGIN");
    try {
      for (const q of plan(state, rol, scramVerifier(parola))) await c.query(q);
      // G5 okuma rolü ayrı kayıt noktasında: düşerse uygulama rolü yine kurulur, okuma girişi kapanır.
      await c.query("SAVEPOINT okuma");
      try {
        for (const q of readStatements) await c.query(q);
        await c.query("RELEASE SAVEPOINT okuma");
      } catch (e) {
        await c.query("ROLLBACK TO SAVEPOINT okuma");
        log(`! Okuma rolu kurulamadi: ${(e as { code?: string }).code ?? ""} ${(e as Error).message}`);
        readResult = "closed";
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw e;
    }
    const violations = readResult === "ready" ? await readRoleViolations(c, readRoleName) : ["kurulamadi"];
    if (violations.length > 0) {
      readResult = "closed";
      log(`! Okuma rolu dogrulanamadi, giris kapatiliyor: ${violations.slice(0, 5).join(", ")}`);
      if ((await readRoleState(c, readRoleName)).exists) await c.query(`ALTER ROLE "${readRoleName}" NOLOGIN`);
    } else {
      log(`OK ${readRoleName} hazir: yalniz SELECT (sir tablo/kolonlari haric), ${readStatements.length} ifade.`);
    }
    const uyg = new URL(s.ownerUrl);
    uyg.username = encodeURIComponent(rol);
    uyg.password = parola;
    const kod = await verifyAppRole(uyg.toString(), rol, log);
    const extra = { state, statements, readStatements, readResult };
    return kod === EXIT_OK ? { kod, appUrl: uyg.toString(), ...extra } : { kod, ...extra };
  } catch (e) {
    if (e instanceof NotApplicable) { log(`X NotApplicable: ${e.message}`); return { kod: EXIT_NOT_APPLICABLE }; }
    // pg hata iletisi ifadeyi değil yalnız nedeni taşır; ifade parolayı taşıyabileceği için basılmaz.
    log(`X Rol gocu basarisiz: ${(e as { code?: string }).code ?? ""} ${(e as Error).message}`);
    return { kod: EXIT_ERROR };
  } finally {
    await c.end().catch(() => undefined);
  }
}

/** Uygulama rolüyle bağlanıp /health ile AYNI yüklemi koşar: kurcalayamıyor olmalı. */
async function verifyAppRole(appUrl: string, rol: string, log: (s: string) => void): Promise<number> {
  const c = new Client({ connectionString: pgUrl(appUrl) });
  try {
    await c.connect();
    const r = await c.query(AUDIT_TAMPER_SQL);
    if (r.rows[0]?.tamper !== false) { log(`X Dogrulama: ${rol} audit'i hala kurcalayabiliyor.`); return EXIT_ERROR; }
    log(`OK ${rol} hazir: audit'te yalniz SELECT+INSERT, tablo sahibi/super degil.`);
    return EXIT_OK;
  } catch (e) {
    log(`X Dogrulama baglantisi basarisiz (${rol}): ${(e as Error).message}`);
    return EXIT_ERROR;
  } finally {
    await c.end().catch(() => undefined);
  }
}

async function main(argv: string[]): Promise<number> {
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) { process.stderr.write("X DATABASE_URL tanimli degil.\n"); return EXIT_NOT_APPLICABLE; }
  const ri = argv.indexOf("--rol");
  const oi = argv.indexOf("--okuma-rol");
  const uygula = argv.includes("--uygula");
  const result = await runRoleMigration({
    ownerUrl, rol: ri >= 0 ? argv[ri + 1] : undefined, readRole: oi >= 0 ? argv[oi + 1] : undefined, uygula,
  });
  if (result.kod === EXIT_OK && uygula && argv.includes("--url-yaz") && result.appUrl) {
    process.stdout.write(result.appUrl);
  }
  return result.kod;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (k) => { process.exitCode = k; },
    (e: unknown) => { process.stderr.write(`X ${(e as Error).message}\n`); process.exitCode = EXIT_ERROR; },
  );
}

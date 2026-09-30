// GÖNDERİCİ ROLÜ — göç `satici_bildirim`i NOLOGIN doğurur ve yetkisini verir (YALNIZ `bildirim`de SELECT + durum
// kolonlarında UPDATE); girişi (LOGIN + parola) kurulumda bu modül açar. Parola stdin'den gelir (argv/ortam ASLA),
// SCRAM-SHA-256 doğrulayıcısı İSTEMCİDE kurulur → düz parola sunucuya, sorgu günlüğüne, `pg_stat_activity`e gitmez.
// Giriş açılmadan ÖNCE yetki kümesi ölçülür: rol fazladan tek bir yetki taşıyorsa RED (fail-closed).
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import type { Client } from "pg";

export const SENDER_ROLE = "satici_bildirim";
/** Göçün kolon düzeyinde UPDATE verdiği kolonlar — gönderici YALNIZ bunları yazar (bekçi ölçer). */
export const SENDER_UPDATE_COLUMNS = ["durum", "deneme", "sonrakiDeneme", "kilitBitis", "sonHata", "saglayiciKimligi", "gonderimZamani", "updatedAt"] as const;
/** satici-baslat.sh URL'i parolayla kurar: yalnız harf/rakam (onaltılık üretilir). */
export const SENDER_PASSWORD = /^[0-9A-Za-z]{32,128}$/;
const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** SCRAM-SHA-256 doğrulayıcısı (RFC 5802/7677; PostgreSQL biçimi). Parola ASCII harf/rakam → SASLprep kimliktir. */
export function scramVerifier(password: string, iterations = 4096): string {
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

export interface PrivilegeReport {
  /** Ölçülen fazla yetkiler ("tablo:YETKİ"); boş = en az yetki. */
  readonly extra: string[];
  /** Beklenen ama eksik yetkiler. */
  readonly missing: string[];
  readonly tables: number;
}

/**
 * Rolün BU DB'deki yetki kümesi (üyelikten gelenler dahil): her tablo × her tablo yetkisi, her kolon UPDATE'i,
 * her dizi. Beklenen TAM küme: `bildirim` SELECT + `SENDER_UPDATE_COLUMNS` UPDATE; başka hiçbir şey.
 */
export async function privilegeReport(client: Client, role: string): Promise<PrivilegeReport> {
  if (!ROLE_NAME.test(role)) throw new Error("Rol adı biçimsiz");
  const extra: string[] = [];
  const missing: string[] = [];
  // Yetki türleri elle sayılmaz, SUNUCUNUN kataloğundan gelir (tablo sahibinin varsayılan ACL'i = bütün tablo
  // yetkileri): PostgreSQL yeni bir tür eklerse (17: MAINTAIN) ölçüm kendiliğinden kapsar.
  const grid = await client.query<{ t: string; p: string; v: boolean }>(
    `WITH x AS (SELECT DISTINCT (aclexplode(acldefault('r', r.oid))).privilege_type AS p FROM pg_roles r WHERE r.rolname = current_user)
     SELECT t.tablename AS t, x.p, has_table_privilege($1, format('%I.%I', 'public', t.tablename), x.p) AS v
       FROM pg_tables t CROSS JOIN x WHERE t.schemaname = 'public'`,
    [role],
  );
  if (new Set(grid.rows.map((r) => r.p)).size < 7) throw new Error("Yetki türleri ölçülemedi (katalog beklenenden dar)");
  const tables = new Set(grid.rows.map((r) => r.t));
  for (const r of grid.rows) {
    const expected = r.t === "bildirim" && r.p === "SELECT";
    if (r.v && !expected) extra.push(`${r.t}:${r.p}`);
    if (!r.v && expected) missing.push(`${r.t}:${r.p}`);
  }
  if (!tables.has("bildirim")) missing.push("bildirim tablosu yok");
  const cols = await client.query<{ c: string; v: boolean }>(
    "SELECT column_name AS c, has_column_privilege($1, 'public.bildirim', column_name, 'UPDATE') AS v FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bildirim'",
    [role],
  );
  for (const r of cols.rows) {
    const expected = (SENDER_UPDATE_COLUMNS as readonly string[]).includes(r.c);
    if (r.v && !expected) extra.push(`bildirim.${r.c}:UPDATE`);
    if (!r.v && expected) missing.push(`bildirim.${r.c}:UPDATE`);
  }
  const seqs = await client.query<{ s: string }>(
    "SELECT sequencename AS s FROM pg_sequences WHERE schemaname = 'public' AND (has_sequence_privilege($1, format('%I.%I', 'public', sequencename), 'USAGE') OR has_sequence_privilege($1, format('%I.%I', 'public', sequencename), 'SELECT') OR has_sequence_privilege($1, format('%I.%I', 'public', sequencename), 'UPDATE'))",
    [role],
  );
  for (const r of seqs.rows) extra.push(`dizi ${r.s}`);
  return { extra, missing, tables: tables.size };
}

/**
 * Girişi aç: rol göçün rolü (ya da onun üyesi) ve yetki kümesi TAM beklenen olmalı; sonra LOGIN + SCRAM
 * doğrulayıcısı + bağlantı tavanı. İdempotent (parola döndürme de aynı komut).
 */
export async function enableSenderLogin(client: Client, g: { role: string; password: string }): Promise<PrivilegeReport> {
  if (!ROLE_NAME.test(g.role)) throw new Error("Rol adı biçimsiz");
  if (!SENDER_PASSWORD.test(g.password)) throw new Error("Parola 32–128 harf/rakam olmalı (onaltılık üretin: openssl rand -hex 32)");
  const member = await client.query<{ v: boolean }>("SELECT pg_has_role($1, $2, 'MEMBER') AS v", [g.role, SENDER_ROLE]);
  if (member.rows[0]?.v !== true) throw new Error(`${g.role} rolü ${SENDER_ROLE} değil ve onun üyesi değil`);
  const attrs = await client.query<{ s: boolean; b: boolean; c: boolean; d: boolean }>(
    "SELECT rolsuper AS s, rolbypassrls AS b, rolcreaterole AS c, rolcreatedb AS d FROM pg_roles WHERE rolname = $1",
    [g.role],
  );
  const a = attrs.rows[0];
  if (!a || a.s || a.b || a.c || a.d) throw new Error(`${g.role} rolü süper kullanıcı/RLS atlayan/rol ya da DB yaratan olamaz`);
  const report = await privilegeReport(client, g.role);
  if (report.extra.length > 0 || report.missing.length > 0) {
    throw new Error(`${g.role} yetki kümesi beklenenden farklı — fazla: ${report.extra.join(", ") || "yok"} · eksik: ${report.missing.join(", ") || "yok"} (göç uygulandı mı?)`);
  }
  // Doğrulayıcı yalnız base64 + `$:` taşır (tırnak yok) — sorguya gömülmesi güvenli; ALTER ROLE parametre almaz.
  await client.query(`ALTER ROLE "${g.role}" WITH LOGIN CONNECTION LIMIT 4 PASSWORD '${scramVerifier(g.password)}'`);
  return report;
}

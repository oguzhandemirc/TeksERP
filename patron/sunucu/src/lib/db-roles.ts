// ROL VE YETKİ UYGULAMA MEKANİĞİ — merkezde `scripts/db-rolleri.ts`, tesis DB'lerinde `tesis-db-hazirlik.ts`
// aynı fonksiyonları çağırır (yetki BEYANI `db-grants.ts`te). Hepsi göç rolüyle (tablo sahibi) ve idempotent.
// Parola çıktıya/günlüğe YAZILMAZ: hata iletisi rol adını taşır, parolayı taşımaz.
import type { Client } from "pg";
import { CLOUD_TABLES, SUPPORT_GRANTS, type ColumnGrants, type Privilege } from "./db-grants";

export const ident = (s: string): string => `"${s.replace(/"/g, '""')}"`;
export const literal = (s: string): string => `'${s.replace(/'/g, "''")}'`;

const ROLE_ATTRS = "LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT";

/** Çalışma rolü: yoksa CREATE, varsa ALTER (özellikler + parola hizalanır). */
export async function ensureLoginRole(client: Client, name: string, password: string): Promise<void> {
  const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [name]);
  const verb = exists.rowCount === 0 ? "CREATE" : "ALTER";
  try {
    await client.query(`${verb} ROLE ${ident(name)} WITH ${ROLE_ATTRS} PASSWORD ${literal(password)}`);
  } catch (err) {
    // 42710 = yarışta öteki taraf az önce kurdu; ALTER ile hizala.
    if ((err as { code?: string }).code !== "42710") throw new Error(`${name} rolü kurulamadı (${(err as { code?: string }).code ?? "?"})`);
    await client.query(`ALTER ROLE ${ident(name)} WITH ${ROLE_ATTRS} PASSWORD ${literal(password)}`);
  }
}

/** DB'ye bağlanma yalnız verilen rollere (PUBLIC'ten geri alınır). */
export async function restrictConnect(client: Client, database: string, roles: readonly string[]): Promise<void> {
  await client.query(`REVOKE CONNECT ON DATABASE ${ident(database)} FROM PUBLIC`);
  if (roles.length > 0) await client.query(`GRANT CONNECT ON DATABASE ${ident(database)} TO ${roles.map(ident).join(", ")}`);
}

/** Tablo REVOKE'u kolon yetkilerini de geri alır (PG) ⇒ beyandan düşen yetki DB'de kalmaz. */
export async function grantAll(client: Client, role: string, grants: Readonly<Record<string, readonly Privilege[]>>, columnGrants: ColumnGrants): Promise<void> {
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ident(role)}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${ident(role)}`);
  for (const [table, privileges] of Object.entries(grants)) {
    if (!CLOUD_TABLES.includes(table)) throw new Error(`Yetki listesinde bilinmeyen tablo: ${table}`);
    await client.query(`GRANT ${privileges.join(", ")} ON ${ident(table)} TO ${ident(role)}`);
  }
  for (const [table, byPrivilege] of Object.entries(columnGrants)) {
    if (!CLOUD_TABLES.includes(table)) throw new Error(`Kolon yetki listesinde bilinmeyen tablo: ${table}`);
    for (const [privilege, columns] of Object.entries(byPrivilege)) {
      if (!columns || columns.length === 0) continue;
      if (grants[table]?.includes(privilege as Privilege)) throw new Error(`${table}: ${privilege} hem tablo hem kolon düzeyinde beyanlı`);
      await client.query(`GRANT ${privilege} (${columns.map(ident).join(", ")}) ON ${ident(table)} TO ${ident(role)}`);
    }
  }
}

/** İki yetki beyanının birleşimi (aynı tablo iki tarafta varsa yetkiler birleşir). */
export function mergeGrants(...all: Readonly<Record<string, readonly Privilege[]>>[]): Record<string, Privilege[]> {
  const out: Record<string, Privilege[]> = {};
  for (const g of all) for (const [t, p] of Object.entries(g)) out[t] = [...new Set([...(out[t] ?? []), ...p])];
  return out;
}

/**
 * Destek rolü (Ek-6/B §3.2): göç NOLOGIN kurar (politikalar adıyla anar); burada özellikleri sertleşir ve
 * yetkileri verilir (`grants` boş = hiçbir tabloyu okuyamaz; merkez kipi). LOGIN'e DOKUNULMAZ — runbook'la açılır.
 */
export async function applySupportRole(client: Client, database: string, role: string, grants: Readonly<Record<string, "*" | readonly string[]>> = SUPPORT_GRANTS): Promise<string> {
  const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
  if (exists.rowCount === 0) throw new Error(`Destek rolü ${role} yok — önce göç`);
  await client.query(`ALTER ROLE ${ident(role)} WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`);
  await client.query(`GRANT CONNECT ON DATABASE ${ident(database)} TO ${ident(role)}`);
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ident(role)}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${ident(role)}`);
  for (const [table, columns] of Object.entries(grants)) {
    if (!CLOUD_TABLES.includes(table)) throw new Error(`Destek yetki listesinde bilinmeyen tablo: ${table}`);
    const target = columns === "*" ? "" : ` (${columns.map(ident).join(", ")})`;
    await client.query(`GRANT SELECT${target} ON ${ident(table)} TO ${ident(role)}`);
  }
  return role;
}

/** DB bağı işareti: her tx'in ilk ifadesi okur (`lib/tenant.ts`); yeni bağlantılarda geçerli olur. */
export async function markDatabase(client: Client, database: string, mark: string): Promise<void> {
  await client.query(`ALTER DATABASE ${ident(database)} SET app.veritabani_tesisi = ${literal(mark)}`);
}

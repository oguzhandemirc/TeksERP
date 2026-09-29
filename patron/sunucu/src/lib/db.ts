// Prisma istemcileri (Prisma 7 + pg sürücü bağdaştırıcısı). Sunucu İKİ rolle bağlanır — uygulama
// (hesap API'si) ve eşitleme (fabrika kanalı + bakım) — ikisi de NOSUPERUSER NOBYPASSRLS; göç rolü
// (tablo sahibi) yalnız migration ve satıcı CLI'sidir. Her sorgu `lib/tenant.ts` kapsamından geçer:
// kapsamsız sorgu RLS'te HATA verir (fail-closed).
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PG_SESSION_OPTIONS } from "./pg-session";

export interface Database {
  readonly label: string;
  readonly pool: Pool;
  readonly prisma: PrismaClient;
}

export function createDatabase(url: string, label: string, max = 10): Database {
  const pool = new Pool({
    connectionString: url,
    max,
    idleTimeoutMillis: 600_000,
    connectionTimeoutMillis: 5_000,
    options: PG_SESSION_OPTIONS,
  });
  pool.on("error", (err) => {
    console.error(`[patron] pg havuzu (${label}): boşta bağlantı düştü (${err.message})`);
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool), transactionOptions: { maxWait: 5_000, timeout: 20_000 } });
  return { label, pool, prisma };
}

export async function closeDatabase(db: Database): Promise<void> {
  await db.prisma.$disconnect().catch(() => undefined);
  await db.pool.end().catch(() => undefined);
}

/** Rol RLS'i atlayabiliyor mu (süper kullanıcı ya da BYPASSRLS)? Açılış kapısı: evetse sunucu KALKMAZ. */
export async function roleBypassesRls(db: Database): Promise<{ role: string; bypass: boolean }> {
  const r = await db.pool.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
    "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
  );
  const row = r.rows[0];
  if (!row) return { role: "?", bypass: true };
  return { role: row.rolname, bypass: row.rolsuper || row.rolbypassrls };
}

export type Tx = Prisma.TransactionClient;

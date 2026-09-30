// Gönderici DB bağlantısı — satıcının süreç tekil istemcisinden (`lib/prisma.ts`) AYRI: yan konteyner kendi
// rolüyle (yalnız `bildirim`de SELECT + durum kolonlarında UPDATE) ve küçük bir havuzla bağlanır.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PG_SESSION_OPTIONS } from "../lib/pg-session";

export interface SenderDb {
  readonly prisma: PrismaClient;
  close(): Promise<void>;
}

export function openSenderDb(url: string): SenderDb {
  const pool = new Pool({ connectionString: url, max: 2, idleTimeoutMillis: 60_000, connectionTimeoutMillis: 5_000, options: PG_SESSION_OPTIONS });
  pool.on("error", (err) => console.error(`[bildirim] pg havuzu: boşta bağlantı düştü (${err.message})`));
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  return {
    prisma,
    close: async () => {
      await prisma.$disconnect().catch(() => undefined);
      await pool.end().catch(() => undefined);
    },
  };
}

interface PrivilegeProbe {
  readonly oku: boolean;
  readonly kurulum: boolean;
  readonly ekle: boolean;
  readonly sil: boolean;
  readonly govde: boolean;
}

/**
 * Açılış kapısı (fail-closed): bağlanan rol `bildirim`i okuyabilmeli ama kurulumu okuyamamalı, `bildirim`e satır
 * ekleyip silememeli ve gövdeyi değiştirememeli — sahip rolle (satıcının URL'i) yanlışlıkla kalkan gönderici DURUR.
 */
export async function assertLeastPrivilege(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<PrivilegeProbe[]>`
    SELECT has_table_privilege('bildirim', 'SELECT') AS oku,
           has_table_privilege('kurulum', 'SELECT') AS kurulum,
           has_table_privilege('bildirim', 'INSERT') AS ekle,
           has_table_privilege('bildirim', 'DELETE') AS sil,
           has_column_privilege('bildirim', 'govde', 'UPDATE') AS govde`;
  const r = rows[0];
  if (!r?.oku) throw new Error("Gönderici DB rolü `bildirim` tablosunu okuyamıyor (göç ya da rol kurulumu eksik)");
  const extra = [r.kurulum ? "kurulum okunuyor" : "", r.ekle ? "bildirim'e ekleme" : "", r.sil ? "bildirim silme" : "", r.govde ? "gövde yazımı" : ""].filter(Boolean);
  if (extra.length > 0) throw new Error(`Gönderici DB rolü FAZLA yetkili (${extra.join(", ")}) — yalnız satici_bildirim rolüyle çalışır`);
}

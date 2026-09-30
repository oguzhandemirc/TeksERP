// Gönderici DB bağlantısı — satıcının süreç tekil istemcisinden (`lib/prisma.ts`) AYRI: yan konteyner kendi
// rolüyle (yalnız `bildirim`de SELECT + durum kolonlarında UPDATE) ve küçük bir havuzla bağlanır.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PG_SESSION_OPTIONS } from "../lib/pg-session";
import { privilegeReport, type PrivilegeReport, type Queryable } from "./sender-role";

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

/**
 * Açılış kapısı (fail-closed): bağlanan rolün TAM yetki kümesi girişi açan yolla aynı ölçümden geçer (`privilegeReport`:
 * tablo × yetki · kolon · dizi · öznitelik — REPLICATION dahil · rol üyeliği — önceden tanımlı roller dahil · public dışı
 * şema · veritabanı CREATE · fonksiyon EXECUTE). Fazla tek kalem → gönderici DURUR; ölçülemezse de durur. Sahip rolle
 * (satıcının URL'i) yanlışlıkla kalkan gönderici böyle durur.
 */
export async function assertLeastPrivilege(prisma: PrismaClient): Promise<void> {
  const q: Queryable = { query: async <R>(sql: string, params: unknown[]) => ({ rows: await prisma.$queryRawUnsafe<R[]>(sql, ...params) }) };
  let report: PrivilegeReport;
  try {
    const me = (await q.query<{ u: string }>("SELECT current_user::text AS u", [])).rows[0]?.u ?? "";
    report = await privilegeReport(q, me);
  } catch (err) {
    throw new Error(`Gönderici DB rolünün yetkisi ÖLÇÜLEMEDİ (${(err as Error).message.slice(0, 160)}) — fail-closed, gönderici durur`);
  }
  if (report.missing.includes("bildirim:SELECT")) throw new Error("Gönderici DB rolü `bildirim` tablosunu okuyamıyor (göç ya da rol kurulumu eksik)");
  if (report.extra.length > 0) {
    const shown = report.extra.slice(0, 12).join(", ");
    throw new Error(`Gönderici DB rolü FAZLA yetkili (${shown}${report.extra.length > 12 ? ` … +${report.extra.length - 12}` : ""}) — yalnız satici_bildirim rolüyle çalışır`);
  }
  if (report.missing.length > 0) throw new Error(`Gönderici DB rolünün yetkisi EKSİK (${report.missing.join(", ")}) — göç ya da rol kurulumu eksik`);
}

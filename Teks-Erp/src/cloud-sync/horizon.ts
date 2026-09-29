// GÜVENLİ UFUK (§4.1): bir turda okunabilecek en geç an. `updatedAt` deyim anında yazılır
// ve COMMIT'ten öncedir; açık bir tx'in satırı okunduktan SONRA commit ederse filigran onu
// sonsuza dek atlar. Ufuk = min(açık tx'lerin başlangıcı, DB şimdi) − pay: ufuktan önce
// başlamış açık tx kalmadığından `t < H` olan her satırın tx'i bitmiştir.
import prisma from "../lib/prisma";

/** Sabit pay (uygulama ile DB saat farkı ayrıca eklenir — Prisma damgası uygulama saatidir). */
export const HORIZON_BASE_MARGIN_MS = 2_000;
/** Bu kadar süre ilerlemeyen ufuk "takıldı" sayılır (bulut bandı + sistem sağlığı). */
export const HORIZON_STUCK_MS = 15 * 60 * 1000;

export interface Horizon {
  readonly at: Date;
  readonly dbNow: Date;
  /** Ufku tutan en eski açık tx'in başlangıcı (yoksa null). */
  readonly oldestOpenTx: Date | null;
  readonly marginMs: number;
}

/**
 * `pg_stat_activity.xact_start` yalnız aynı rolün oturumlarında (ya da `pg_read_all_stats`
 * üyesine) görünür; backend'in bütün bağlantıları tek uygulama rolüyle açılır.
 */
export async function computeHorizon(appNowMs: number = Date.now()): Promise<Horizon> {
  const rows = await prisma.$queryRaw<Array<{ db_now: Date; oldest: Date | null }>>`
    SELECT clock_timestamp() AS db_now,
           min(xact_start) FILTER (WHERE pid <> pg_backend_pid() AND xact_start IS NOT NULL) AS oldest
      FROM pg_stat_activity
     WHERE datname = current_database()`;
  const row = rows[0];
  if (!row) throw new Error("pg_stat_activity okunamadı");
  const dbNow = row.db_now;
  const marginMs = HORIZON_BASE_MARGIN_MS + Math.abs(appNowMs - dbNow.getTime());
  const base = row.oldest && row.oldest.getTime() < dbNow.getTime() ? row.oldest : dbNow;
  return { at: new Date(base.getTime() - marginMs), dbNow, oldestOpenTx: row.oldest, marginMs };
}

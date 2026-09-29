// `sync_marks` BUDAMASI — telemetri sınıfı (defter DEĞİL): bir işaret silindiğinde raporlanan
// hiçbir sayı değişmez, işaret yalnız "bu kökü buluta yeniden gönder" der. Bulutun onayladığı
// zincirin gerisinde kalan ve 7 günden eski işaret gider; eşitleme uzun süre durmuşsa 30
// günden eskisi yine gider (kaçan silmeyi günlük uzlaştırma TAM gönderimle onarır).
import prisma from "../lib/prisma";
import { wmKey } from "./watermarks";

export const MARK_KEEP_DAYS = 7;
export const MARK_MAX_KEEP_DAYS = 30;
const DAY_MS = 86_400_000;

/** SAF — budama eşiği: onaylı en geri zincir ile 7 gün sınırının erkeni, ama 30 günden geri değil. */
export function markPruneCutoff(nowMs: number, oldestAckedChainMs: number | null): Date {
  const keep = nowMs - MARK_KEEP_DAYS * DAY_MS;
  const floor = nowMs - MARK_MAX_KEEP_DAYS * DAY_MS;
  const bound = oldestAckedChainMs === null ? keep : Math.min(keep, oldestAckedChainMs);
  return new Date(Math.max(bound, floor));
}

export async function pruneSyncMarks(nowMs: number = Date.now()): Promise<number> {
  const chains = await prisma.syncWatermark.findMany({
    where: { source: { startsWith: wmKey.chain("") }, watermarkAt: { not: null } },
    select: { watermarkAt: true },
  });
  const oldest = chains.reduce<number | null>((m, c) => {
    const t = c.watermarkAt!.getTime();
    return m === null || t < m ? t : m;
  }, null);
  const cutoff = markPruneCutoff(nowMs, oldest);
  const r = await prisma.syncMark.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return r.count;
}

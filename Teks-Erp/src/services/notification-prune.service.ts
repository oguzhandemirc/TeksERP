// =============================================================================
// BİLDİRİM BUDAMASI — telemetri tablolarının TEK budayıcısı (plan §3.4, B2)
// =============================================================================
// Gelen kutusu/outbox/günlük sayaç TELEMETRİ, koşullar DURUM'dur (defter değil): satır silinince
// hiçbir rapor sayısı değişmez. Süreler: kutu okunmuş 90 / okunmamış 180 gün (katalog `saklama`) ·
// outbox işlendikten 7 gün (düşüp vazgeçilen satır da 7 gün) · çözülmüş koşul 180 gün · sayaç 35 gün.
// Açık koşul ve çözülmemiş satır yaşından bağımsız KALIR. Beyan: `scripts/test_telemetri_defter_degil.ts`.
// Çağıran: `jobs/maintenance.job.ts` gece penceresi.
// =============================================================================
import prisma from "../lib/prisma";
import { NOTIFICATION_CATALOG, NOTIFICATION_KINDS } from "../constants/notification-catalog";
import { factoryDayKeyUtcMidnight } from "../constants/time";
import { DISPATCH_MAX_ATTEMPTS } from "./notification-dispatch.service";

const DAY_MS = 24 * 60 * 60 * 1000;
export const NOTIFICATION_RETENTION = {
  /** Katalogda artık olmayan türün kutu satırı için (katalog varsayılanıyla aynı). */
  inboxReadDays: 90,
  inboxUnreadDays: 180,
  outboxDays: 7,
  conditionResolvedDays: 180,
  dailyStatsDays: 35,
} as const;

export interface NotificationPruneResult {
  inbox: number;
  outbox: number;
  conditions: number;
  dailyStats: number;
}

const ago = (now: Date, days: number): Date => new Date(now.getTime() - days * DAY_MS);

export async function pruneNotifications(now: Date = new Date()): Promise<NotificationPruneResult> {
  // Saklama katalogdan tür başına; aynı süreli türler tek DELETE'te.
  const groups = new Map<string, { read: number; unread: number; kinds: string[] }>();
  for (const kind of NOTIFICATION_KINDS) {
    const s = NOTIFICATION_CATALOG[kind].saklama;
    const k = `${s.okunmusGun}:${s.okunmamisGun}`;
    const g = groups.get(k) ?? { read: s.okunmusGun, unread: s.okunmamisGun, kinds: [] };
    g.kinds.push(kind);
    groups.set(k, g);
  }
  const R = NOTIFICATION_RETENTION;
  groups.set("katalog-disi", { read: R.inboxReadDays, unread: R.inboxUnreadDays, kinds: [] });

  let inbox = 0;
  for (const [key, g] of groups) {
    const kindWhere = key === "katalog-disi" ? { kind: { notIn: [...NOTIFICATION_KINDS] } } : { kind: { in: g.kinds } };
    const r = await prisma.notificationInbox.deleteMany({
      where: {
        ...kindWhere,
        OR: [
          { readAt: { lt: ago(now, g.read) } },
          { readAt: null, lastAt: { lt: ago(now, g.unread) } },
        ],
      },
    });
    inbox += r.count;
  }

  const outbox = await prisma.notificationOutbox.deleteMany({
    where: {
      OR: [
        { processedAt: { lt: ago(now, R.outboxDays) } },
        { processedAt: null, attempts: { gte: DISPATCH_MAX_ATTEMPTS }, createdAt: { lt: ago(now, R.outboxDays) } },
      ],
    },
  });
  const conditions = await prisma.notificationCondition.deleteMany({
    where: { resolvedAt: { lt: ago(now, R.conditionResolvedDays) } },
  });
  // Fabrika günü anahtarı (UTC gece yarısı biçiminde) — `@db.Date` kolonuyla aynı uzay.
  const dailyStats = await prisma.notificationDailyStats.deleteMany({
    where: { factoryDay: { lt: new Date(factoryDayKeyUtcMidnight(now).getTime() - R.dailyStatsDays * DAY_MS) } },
  });
  return { inbox, outbox: outbox.count, conditions: conditions.count, dailyStats: dailyStats.count };
}

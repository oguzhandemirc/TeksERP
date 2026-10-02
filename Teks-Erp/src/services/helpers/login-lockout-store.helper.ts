// Giriş kilidi kovalarının KALICI kopyası (yeniden başlatmada kilit ve ceza merdiveni sıfırlanmasın).
// Bellekteki harita tek süreçte otoritedir; burası yalnız yükleme/yazma/budama yapar.
import prisma from "../../lib/prisma";

export interface StoredBucket {
  keyHash: string;
  fails: number;
  penaltyRounds: number;
  blockedUntil: number;
  lastFailAt: number;
}

/** Boşta kalan kova bu süreden sonra budanır (ceza merdiveni çoktan çürümüştür). */
export const LOCKOUT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Hâlâ anlamlı (bloklu, merdivende ya da sayacı dolu) kovaları yükler. */
export async function loadActiveBuckets(limit: number, now = new Date()): Promise<StoredBucket[]> {
  const rows = await prisma.loginLockoutBucket.findMany({
    where: { OR: [{ blockedUntil: { gt: now } }, { penaltyRounds: { gt: 0 } }, { fails: { gt: 0 } }] },
    orderBy: { lastFailAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    keyHash: r.keyHash,
    fails: r.fails,
    penaltyRounds: r.penaltyRounds,
    blockedUntil: r.blockedUntil?.getTime() ?? 0,
    lastFailAt: r.lastFailAt?.getTime() ?? 0,
  }));
}

export async function saveBucket(b: StoredBucket): Promise<void> {
  const data = {
    fails: b.fails,
    penaltyRounds: b.penaltyRounds,
    blockedUntil: b.blockedUntil > 0 ? new Date(b.blockedUntil) : null,
    lastFailAt: b.lastFailAt > 0 ? new Date(b.lastFailAt) : null,
  };
  await prisma.loginLockoutBucket.upsert({
    where: { keyHash: b.keyHash },
    create: { keyHash: b.keyHash, ...data },
    update: data,
  });
}

/** Yaşa göre budama: son denemesi saklama süresinden eski ve bloğu bitmiş kovalar. */
export async function pruneIdleBuckets(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - LOCKOUT_RETENTION_MS);
  const res = await prisma.loginLockoutBucket.deleteMany({
    where: {
      lastFailAt: { lt: cutoff },
      OR: [{ blockedUntil: null }, { blockedUntil: { lt: now } }],
    },
  });
  return res.count;
}

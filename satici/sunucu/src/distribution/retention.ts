// DAĞITIM SAKLAMA İŞİ (bakım adımı) — İKİ iş, ikisi de SATIR SİLMEZ:
//   · Gövde budaması: saklama süresi dolan dosyanın GÖVDESİ diskten silinir; `dagitim_dosyasi` satırı KALIR
//     (`govdeBudandiAt` durum kolonu) ve defter GOVDE_BUDANDI satırı alır. Defter "ne oldu"yu tutar, gövde değil.
//   · Yarıda kalan yükleme: `YUKLEME_TERK_SAAT` boyunca parça gelmeyen açık oturum TERK olur (kota iadesi,
//     parçalar silinir, defter YUKLEME_TERK).
// Tur başına en çok BATCH kayıt (uzun tur bakımın diğer adımlarını geciktirmesin).
import type { VendorConfig } from "../config";
import { lockSharedFile } from "../lib/locks";
import { prisma } from "../lib/prisma";
import { abandonSession } from "./sessions.service";
import { bodyPath, removeQuietly } from "./storage";
import { appendLedger } from "./tokens";

const BATCH = 100;

/** Gövdesi budanan tablolar (satır kalır, disk gövdesi silinir) — beyan; bekçi: test_dagitim_budama. */
export const BODY_PRUNED_MODELS = ["dagitimDosyasi"] as const;

export async function pruneExpiredBodies(config: VendorConfig, nowMs: number): Promise<number> {
  const now = new Date(nowMs);
  const due = await prisma.dagitimDosyasi.findMany({
    where: { saklamaBitis: { lte: now }, govdeBudandiAt: null },
    orderBy: [{ saklamaBitis: "asc" }, { id: "asc" }],
    take: BATCH,
    select: { id: true },
  });
  let pruned = 0;
  for (const { id } of due) {
    const file = await prisma.$transaction(async (tx) => {
      await lockSharedFile(tx, id);
      const claimed = await tx.dagitimDosyasi.updateMany({ where: { id, govdeBudandiAt: null, saklamaBitis: { lte: now } }, data: { govdeBudandiAt: now } });
      if (claimed.count === 0) return null;
      const f = await tx.dagitimDosyasi.findUniqueOrThrow({ where: { id } });
      await appendLedger(tx, { event: "GOVDE_BUDANDI", customerId: f.musteriId, actor: "sistem:saklama", fileId: f.id, detail: { saklamaBitis: f.saklamaBitis.toISOString(), boyut: Number(f.boyut) } });
      return f;
    });
    if (!file) continue;
    await removeQuietly(bodyPath(config.DOSYA_DIZINI, file.depoAnahtari));
    pruned++;
  }
  return pruned;
}

export async function abandonStaleSessions(config: VendorConfig, nowMs: number): Promise<number> {
  const before = new Date(nowMs - config.YUKLEME_TERK_SAAT * 3_600_000);
  const stale = await prisma.yuklemeOturumu.findMany({
    where: { durum: "ACIK", sonEtkinlik: { lt: before } },
    orderBy: [{ sonEtkinlik: "asc" }, { id: "asc" }],
    take: BATCH,
    select: { id: true, istekId: true, musteriId: true, toplamBayt: true },
  });
  let n = 0;
  for (const s of stale) if (await abandonSession(config, s, "sistem:saklama", "SURE_ASIMI", before)) n++;
  return n;
}

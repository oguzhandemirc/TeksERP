// =============================================================================
// PATRON RAPOR KOŞUMU BUDAMASI — `PatronReportRun`un TEK budayıcısı (V5a)
// =============================================================================
// TELEMETRİ (türetilmiş önbellek, beyan `scripts/test_telemetri_defter_degil.ts`): sayı kaynak serviste yeniden
// hesaplanır, satır silinince raporlanan hiçbir sayı değişmez ⇒ gerçek budama izinli. İstek anında (yeni koşum
// bitince) koşar; zamanlanmış iş YOK. Son 1 saat budanmaz: saatlik tavan sayımı silinmiş satırları da sayar.
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { PatronReportLimits } from "../system-setting/patron-rapor";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Bu yaştan genç satır hiç budanmaz (tavan penceresi). */
export const PRUNE_GUARD_MS = 60 * 60 * 1000;

/**
 * Kullanıcının bu rapordaki koşumlarını budar: görünür en yeni `keepCount` dışındakiler, `keepDays`ten eskiler ve
 * silinmiş (soft delete) satırlar — hepsi yalnız `PRUNE_GUARD_MS`ten eskiyse; süren hesap (`HESAPLANIYOR`) dokunulmaz.
 */
export async function prunePatronReportRuns(userId: string, reportKey: string, limits: PatronReportLimits, now: Date = new Date()): Promise<number> {
  const keep = await prisma.patronReportRun.findMany({
    where: { userId, reportKey, deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limits.keepCount,
    select: { id: true },
  });
  const branches: Prisma.PatronReportRunWhereInput[] = [
    { createdAt: { lt: new Date(now.getTime() - limits.keepDays * DAY_MS) } },
    { deletedAt: { not: null } },
  ];
  if (keep.length > 0) branches.push({ reportKey, id: { notIn: keep.map((k) => k.id) } });
  const r = await prisma.patronReportRun.deleteMany({
    where: {
      userId,
      status: { not: "HESAPLANIYOR" },
      createdAt: { lt: new Date(now.getTime() - PRUNE_GUARD_MS) },
      OR: branches,
    },
  });
  return r.count;
}

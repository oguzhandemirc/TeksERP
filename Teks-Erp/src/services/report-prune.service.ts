// =============================================================================
// RAPOR KOŞU / GÖRÜNTÜ BUDAMASI — `ReportRun` ve `ReportSnapshot`un TEK budayıcısı (plan §3.3, R1-ZAMAN)
// =============================================================================
// İkisi de TELEMETRİ'dir (beyan `scripts/test_telemetri_defter_degil.ts`): sayılar semantik katmanda
// yeniden hesaplanır, satır silinince raporlanan hiçbir sayı değişmez. Koşu 90 günde budanır
// (görüntünün `runId`si SET NULL — görüntü kalır). Görüntüden YALNIZ `ZAMANLANMIS` + süresi dolmuş
// satır budanır; `KULLANICI` görüntüsü sahibi silene kadar kalır. Çağıran: `jobs/maintenance.job.ts`.
// =============================================================================
import prisma from "../lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;
export const REPORT_RUN_RETENTION_DAYS = 90;
/** Tek DELETE'in tavanı — gece penceresinde kilidi kısa tutar (audit arşivi emsali). */
export const REPORT_PRUNE_BATCH = 5000;
/** Budanabilen tek görüntü türü; `KULLANICI` bilinçli olarak dışarıda (sahibinin kaydı). */
export const PRUNABLE_SNAPSHOT_KIND = "ZAMANLANMIS";

export function reportRunPruneCutoff(now: Date): Date {
  return new Date(now.getTime() - REPORT_RUN_RETENTION_DAYS * DAY_MS);
}

export async function pruneReportRuns(now: Date = new Date()): Promise<number> {
  const cutoff = reportRunPruneCutoff(now);
  let total = 0;
  for (;;) {
    const batch = await prisma.reportRun.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take: REPORT_PRUNE_BATCH });
    if (batch.length === 0) break;
    // Tarih yüklemi kimlik listesinin yanında KALIR: parti okunduktan sonra doğan satır budanmaz.
    const r = await prisma.reportRun.deleteMany({ where: { id: { in: batch.map((b) => b.id) }, createdAt: { lt: cutoff } } });
    total += r.count;
    if (batch.length < REPORT_PRUNE_BATCH) break;
  }
  return total;
}

export async function pruneExpiredScheduledSnapshots(now: Date = new Date()): Promise<number> {
  let total = 0;
  for (;;) {
    const batch = await prisma.reportSnapshot.findMany({
      where: { kind: PRUNABLE_SNAPSHOT_KIND, expiresAt: { lt: now } }, select: { id: true }, take: REPORT_PRUNE_BATCH,
    });
    if (batch.length === 0) break;
    const r = await prisma.reportSnapshot.deleteMany({
      where: { id: { in: batch.map((b) => b.id) }, kind: "ZAMANLANMIS", expiresAt: { lt: now } },
    });
    total += r.count;
    if (batch.length < REPORT_PRUNE_BATCH) break;
  }
  return total;
}

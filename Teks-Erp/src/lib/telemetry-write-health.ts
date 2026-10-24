// Best-effort telemetri yazımlarının `/health` alanları — audit izi + yazdırma geçmişi aynı soruyu sorar:
// "satırlar sessizce düşüyor mu". Ayrı dosya: health-snapshot.ts max-lines tavanında.
import { AuditService } from "../services/audit.service";
import { getPrintJobHealth } from "../services/print-job.service";
import { flushRequestTraces, getRequestTraceHealth } from "../services/request-trace.service";
import { flushLatencyNow } from "../services/latency-persist.service";

export function telemetryWriteHealth() {
  const audit = AuditService.getHealth();
  return {
    // Audit kaybı izleme (0 = sağlıklı; >0 ise log yazımı başarısız oluyor)
    auditWriteFailures: audit.failureCount,
    lastAuditError: audit.lastError,
    lastAuditFailureAt: audit.lastFailureAt,
    // Yazdırma geçmişi: `dusen > 0` = basım satırları sessizce düşüyor.
    printJobs: getPrintJobHealth(),
    // İstek başlığı (B1): `dusen > 0` = kova taşması ya da yazım hatası.
    requestTraces: getRequestTraceHealth(),
  };
}

/** Kapanışta bellekteki telemetriyi boşalt (gecikme özeti + istek başlığı kuyruğu); hata yutulur. */
export async function flushTelemetryNow(): Promise<void> {
  await Promise.allSettled([flushLatencyNow(), flushRequestTraces()]);
}

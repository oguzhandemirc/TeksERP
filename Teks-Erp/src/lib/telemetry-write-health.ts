// Best-effort telemetri yazımlarının `/health` alanları — audit izi + yazdırma geçmişi aynı soruyu sorar:
// "satırlar sessizce düşüyor mu". Ayrı dosya: health-snapshot.ts max-lines tavanında.
import { AuditService } from "../services/audit.service";
import { getPrintJobHealth } from "../services/print-job.service";

export function telemetryWriteHealth() {
  const audit = AuditService.getHealth();
  return {
    // Audit kaybı izleme (0 = sağlıklı; >0 ise log yazımı başarısız oluyor)
    auditWriteFailures: audit.failureCount,
    lastAuditError: audit.lastError,
    lastAuditFailureAt: audit.lastFailureAt,
    // Yazdırma geçmişi: `dusen > 0` = basım satırları sessizce düşüyor.
    printJobs: getPrintJobHealth(),
  };
}

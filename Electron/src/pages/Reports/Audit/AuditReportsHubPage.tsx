import { ReportHubGrid } from "../_components/ReportHubGrid";
import { auditReportTiles } from "./tile-config";

export function AuditReportsHubPage() {
  return (
    <ReportHubGrid
      title="Sistem Raporları"
      description="Audit log özeti ve kullanıcı aktivitesi."
      tiles={auditReportTiles}
    />
  );
}

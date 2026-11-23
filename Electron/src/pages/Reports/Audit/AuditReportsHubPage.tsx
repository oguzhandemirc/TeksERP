import { screenTitle } from "@/components/layout/screen-title";
import { ReportHubGrid } from "../_components/ReportHubGrid";
import { auditReportTiles } from "./tile-config";

export function AuditReportsHubPage() {
  return (
    <ReportHubGrid
      title={screenTitle("/reports/audit")}
      description="Denetim kaydı özeti ve kullanıcı aktivitesi."
      tiles={auditReportTiles}
    />
  );
}

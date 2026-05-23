import { ReportHubGrid } from "../_components/ReportHubGrid";
import { subcontractReportTiles } from "./tile-config";

export function SubcontractReportsHubPage() {
  return (
    <ReportHubGrid
      title="Fason Raporları"
      description="Fasoncu performansı ve açık sevk takibi."
      tiles={subcontractReportTiles}
    />
  );
}

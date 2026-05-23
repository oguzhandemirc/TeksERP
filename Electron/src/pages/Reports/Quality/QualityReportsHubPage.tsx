import { ReportHubGrid } from "../_components/ReportHubGrid";
import { qualityReportTiles } from "./tile-config";

export function QualityReportsHubPage() {
  return (
    <ReportHubGrid
      title="Kalite Raporları"
      description="Hata türü, istasyon hata oranı, Tambur kararları ve Kurşun."
      tiles={qualityReportTiles}
    />
  );
}

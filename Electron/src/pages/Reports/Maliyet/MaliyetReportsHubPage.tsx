import { ReportHubGrid } from "../_components/ReportHubGrid";
import { maliyetReportTiles } from "./tile-config";

export function MaliyetReportsHubPage() {
  return (
    <ReportHubGrid
      title="Maliyet Raporları"
      description="İplik ihtiyaç planı — yalnız maliyet modülü açıkken; tutar göstermez."
      tiles={maliyetReportTiles}
    />
  );
}

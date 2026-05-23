import { ReportHubGrid } from "../_components/ReportHubGrid";
import { productionReportTiles } from "./tile-config";

export function ProductionReportsHubPage() {
  return (
    <ReportHubGrid
      title="Üretim Raporları"
      description="İstasyon, operatör, makine ve fire analizleri."
      tiles={productionReportTiles}
    />
  );
}

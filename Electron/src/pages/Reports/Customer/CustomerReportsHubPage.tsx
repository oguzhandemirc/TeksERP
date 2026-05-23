import { ReportHubGrid } from "../_components/ReportHubGrid";
import { customerReportTiles } from "./tile-config";

export function CustomerReportsHubPage() {
  return (
    <ReportHubGrid
      title="Müşteri Raporları"
      description="Sipariş profili ve alias kullanım istatistiği."
      tiles={customerReportTiles}
    />
  );
}

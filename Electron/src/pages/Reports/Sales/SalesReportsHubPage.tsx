import { ReportHubGrid } from "../_components/ReportHubGrid";
import { salesReportTiles } from "./tile-config";

export function SalesReportsHubPage() {
  return (
    <ReportHubGrid
      title="Sipariş & Sevkiyat Raporları"
      description="Sipariş gerçekleşme, geç teslim, müşteri sevkiyat hacmi."
      tiles={salesReportTiles}
    />
  );
}

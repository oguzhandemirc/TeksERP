import { ReportHubGrid } from "../_components/ReportHubGrid";
import { inventoryReportTiles } from "./tile-config";

export function InventoryReportsHubPage() {
  return (
    <ReportHubGrid
      title="Stok & Depo Raporları"
      description="Yaşlandırma, dağılım, müşteri mülkü ve hareketler."
      tiles={inventoryReportTiles}
    />
  );
}

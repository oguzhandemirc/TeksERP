// Ön muhasebe rapor kategorisinin hub sayfası.
// İzin filtresi burada YAPILMAZ — kategori kartı `Reports/tile-config.ts`'te
// `report:finance` ile süzülür, sayfa da route'ta `ProtectedRoute` ile korunur.
// Üçüncü bir kapı eklemek, üçünün bir gün ayrışması demektir.
import { ReportHubGrid } from "../_components/ReportHubGrid";
import { financeReportTiles } from "./tile-config";

export function FinanceReportsHubPage() {
  return (
    <ReportHubGrid
      title="Ön Muhasebe Raporları"
      description="Cari yaşlandırma, kasa & banka defteri ve cari ekstre."
      tiles={financeReportTiles}
    />
  );
}

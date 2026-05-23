import { Gauge, UserCog, Cog, ScanBarcode, Trash2 } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

export const productionReportTiles: HubTile[] = [
  {
    key: "station-efficiency",
    title: "İstasyon Verimliliği",
    description: "İstasyon bazında giriş/çıkış, ortalama süre, bekleme",
    icon: Gauge,
    to: "/reports/production/station-efficiency",
  },
  {
    key: "operator-performance",
    title: "Operatör Performansı",
    description: "Operatör başına işlenen top, metraj ve hata oranı",
    icon: UserCog,
    to: "/reports/production/operator-performance",
  },
  {
    key: "machine-usage",
    title: "Makine Kullanımı",
    description: "Makine başına işlem sayısı ve aktif/atıl analizi",
    icon: Cog,
    to: "/reports/production/machine-usage",
  },
  {
    key: "traveler-trace",
    title: "Refakat Kartı İzleme",
    description: "Rulonun istasyon adımları, operatör ve süre geçmişi",
    icon: ScanBarcode,
    to: "/reports/production/traveler-trace",
  },
  {
    key: "scrap",
    title: "Fire & Hurda",
    description: "SCRAP nedenleri, miktar ve fason / iç fire kaynakları",
    icon: Trash2,
    to: "/reports/production/scrap",
  },
];

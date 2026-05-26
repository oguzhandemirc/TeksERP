import { Hourglass, Boxes, ArrowLeftRight } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

export const inventoryReportTiles: HubTile[] = [
  {
    key: "roll-aging",
    title: "Rulo Yaşlandırma",
    description: "Depodaki rulonun bekleme süresi dağılımı",
    icon: Hourglass,
    to: "/reports/inventory/roll-aging",
  },
  {
    key: "stock-distribution",
    title: "Stok Dağılımı",
    description: "Renk, desen ve en bazında stok metrajı",
    icon: Boxes,
    to: "/reports/inventory/stock-distribution",
  },
  {
    key: "movements",
    title: "Hareket Geçmişi",
    description: "Rulo bazında istasyon giriş/çıkış zaman çizelgesi",
    icon: ArrowLeftRight,
    to: "/reports/inventory/movements",
  },
];

import { ClipboardCheck, Clock } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

export const salesReportTiles: HubTile[] = [
  {
    key: "order-fulfillment",
    title: "Sipariş Gerçekleşme",
    description: "Planlanan vs sevk edilen, kısmi sevk oranı",
    icon: ClipboardCheck,
    to: "/reports/sales/order-fulfillment",
  },
  {
    key: "late-delivery",
    title: "Geç Teslimat",
    description: "Termin geçen siparişler ve gecikme süresi",
    icon: Clock,
    to: "/reports/sales/late-delivery",
  },
];

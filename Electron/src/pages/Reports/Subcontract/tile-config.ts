import { Award, AlarmClock } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

export const subcontractReportTiles: HubTile[] = [
  {
    key: "performance",
    title: "Fasoncu Performansı",
    description: "Süre, fire ve kalite metrikleri",
    icon: Award,
    to: "/reports/subcontract/performance",
  },
  {
    key: "open-dispatches",
    title: "Açık Fason Sevkleri",
    description: "Geri gelmemiş rulolar ve yaşlandırma",
    icon: AlarmClock,
    to: "/reports/subcontract/open-dispatches",
  },
];

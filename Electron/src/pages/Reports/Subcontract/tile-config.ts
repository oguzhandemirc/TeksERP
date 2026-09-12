import { Scissors } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

/**
 * Fason raporları — 2026-08-09'da iki rapor tek karneye birleşti.
 *   • "Fasoncu Performansı" → karnenin firma tablosu (üstelik FİRE kolonuyla:
 *     eskisi süre + adet veriyordu, sahada tartışılan metraj farkı yoktu).
 *   • "Açık Fason Sevkleri"  → karnenin "en eski açık sevkler" tablosu.
 */
export const subcontractReportTiles: HubTile[] = [
  {
    key: "scorecard",
    title: "Fason Karnesi",
    description: "Fason firesi (giden ↔ dönen ↔ müşteriye teslim), dönüş süresi ve açık bakiye",
    icon: Scissors,
    to: "/reports/subcontract/scorecard",
  },
];

import { Spool, TrendingUp } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

/**
 * Maliyet raporları (MAL-7) — yalnız `maliyet.enabled` açıkken (karo `featureFlag`, route `ROUTE_MODULE`).
 * Tutar göstermez; izin `report:yarn-need` (backend `maliyet.report.routes.ts`).
 */
export const maliyetReportTiles: HubTile[] = [
  {
    key: "iplik-ihtiyaci",
    title: "İplik İhtiyaç Planı",
    description: "Açık siparişlerin iplik ihtiyacı (çözgü/atkı ayrı) − serbest stok − açık alış − hazır levent = eksik",
    icon: Spool,
    to: "/cost/yarn-need",
  },
  {
    key: "karlilik",
    title: "Kârlılık",
    description: "Hizmet işlerinin kesinleşen geliri; ipe, makineye ve dışarıya giden; kalan (katkı) ve net — müşteri, işlem, makine, ay ya da iş kırılımıyla",
    icon: TrendingUp,
    to: "/reports/maliyet/karlilik",
  },
];

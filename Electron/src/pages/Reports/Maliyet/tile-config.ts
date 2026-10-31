import { Factory, Spool, TrendingUp } from "lucide-react";
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
    permission: "cost:read",
  },
  {
    // SY-D3: tutar gösterir → `cost:read`; dokuma kapalıysa gizli (uç 403 MODULE_DISABLED verir).
    key: "dokuma-verimlilik",
    title: "Dokuma maliyet verimliliği",
    description: "Dokuma iş emri başına standart ve gerçek dokuma maliyeti /m, fark, teorik ve gerçek m/saat, duruş payı",
    icon: Factory,
    to: "/reports/maliyet/dokuma-verimlilik",
    permission: "cost:read",
  },
];

/** Karo görünürlüğü — karo kendi iznini taşır (yoksa `report:yarn-need`); dokuma verimliliği ayrıca dokuma açık (SY-D3). */
export function visibleMaliyetTiles(hasPermission: (code: string) => boolean, weavingOn: boolean): HubTile[] {
  return maliyetReportTiles.filter((t) => (t.key !== "dokuma-verimlilik" || weavingOn) && hasPermission(t.permission ?? "report:yarn-need"));
}

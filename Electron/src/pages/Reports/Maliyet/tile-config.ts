import { Factory, Spool } from "lucide-react";
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
    // SY-D3: tutar gösterir → `cost:read`; dokuma kapalıysa gizli (uç 403 MODULE_DISABLED verir).
    key: "dokuma-verimlilik",
    title: "Dokuma maliyet verimliliği",
    description: "Dokuma işi başına standart ve gerçek dokuma maliyeti /m, fark, teorik ve gerçek m/saat, duruş payı",
    icon: Factory,
    to: "/reports/maliyet/dokuma-verimlilik",
    permission: "cost:read",
  },
];

/** Karo görünürlüğü — iplik ihtiyacı `report:yarn-need`, dokuma verimliliği `cost:read` ∧ dokuma (SY-D3). */
export function visibleMaliyetTiles(hasPermission: (code: string) => boolean, weavingOn: boolean): HubTile[] {
  return maliyetReportTiles.filter((t) =>
    t.key === "dokuma-verimlilik" ? weavingOn && hasPermission(t.permission ?? "cost:read") : hasPermission("report:yarn-need"));
}

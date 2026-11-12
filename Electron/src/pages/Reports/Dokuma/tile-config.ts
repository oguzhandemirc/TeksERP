import { ListChecks, Hourglass } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

/**
 * Dokuma raporları — rapor sözleşmesi `docs/kurallar/dokuma.md` § Raporların sözleşmesi.
 * Üç rapor + karne listesi (mühür eylemleri). Adres kalıbı ÜÇ segment (`ReportSideRail`).
 * Karo yalnız `dokuma.enabled` açıkken çizilir (`dokuma-regime.ts`); levent karoları ayrıca
 * `devere.enabled` ister (uçları `requireDevereEnabled` — kapalıyken karo 403'e açılmaz).
 */
export const dokumaReportTiles: HubTile[] = [
  {
    key: "karne",
    title: "Karne Listesi ve Mühür",
    description: "Vardiya × tezgah karneleri: anlık / mühürlü, terim düzeltme, mühürleme ve mühür açma",
    icon: ListChecks,
    to: "/reports/dokuma/karne",
  },
  {
    key: "levent-bitis-tahmini",
    title: "Levent Bitiş Tahmini",
    description: "Tezgahtaki leventlerin kalanı ve son 7 günlük tüketim hızıyla tahmini bitiş günü (kesit)",
    icon: Hourglass,
    to: "/reports/dokuma/levent-bitis-tahmini",
  },
];

/** Uçları Devere modülüne de bağlı karolar (`dokuma.report.routes` `requireDevereEnabled`). */
export const DEVERE_GEREKEN_KAROLAR: ReadonlySet<string> = new Set(["levent-bitis-tahmini"]);

/** Hub süzmesi — Devere kapalıyken levent karoları çizilmez (çizilse uç 403 `MODULE_DISABLED` döner). */
export function visibleDokumaTiles(tiles: readonly HubTile[], devereEnabled: boolean): HubTile[] {
  return tiles.filter((t) => devereEnabled || !DEVERE_GEREKEN_KAROLAR.has(t.key));
}

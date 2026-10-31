import type { RouteObject } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { REPORT_CATALOG } from "@/lib/report-catalog";
import { ReportV2Route } from "./ReportV2Route";

/**
 * 14 temel raporun yaprak route'ları — KATALOGDAN üretilir (adres `panelYolu`, izin `izin`):
 * elle yazılan liste katalogla ayrışırdı. `hazir:false` satırın route'u da var ama kapı
 * (`ReportV2Route`) onu çizmez; RAP dilimi `hazir:true` yapınca adres kendiliğinden açılır.
 */
/**
 * Kendi yaprak sayfası olan v2 anahtarları — adresi `content-routes` kendisi açar (rapor v2 bayrağından
 * bağımsız görünmesi gereken rapor; D4-H1). Aynı path iki route'ta olmasın diye `content-routes` yayarken atlar.
 */
export const V2_KEYS_WITH_OWN_PAGE: ReadonlySet<string> = new Set(["finance/masraf-ozeti", "production/makine-duruslari", "maliyet/karlilik"]);

export const reportV2Routes: RouteObject[] = REPORT_CATALOG.filter((e) => e.nesil === "v2").map((e) => ({
  path: e.panelYolu,
  element: (
    <ProtectedRoute requirePermission={e.izin}>
      <ReportV2Route reportKey={e.key} />
    </ProtectedRoute>
  ),
}));

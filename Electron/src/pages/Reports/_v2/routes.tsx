import type { RouteObject } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { REPORT_CATALOG } from "@/lib/report-catalog";
import { ReportV2Route } from "./ReportV2Route";

/**
 * 14 temel raporun yaprak route'ları — KATALOGDAN üretilir (adres `panelYolu`, izin `izin`):
 * elle yazılan liste katalogla ayrışırdı. `hazir:false` satırın route'u da var ama kapı
 * (`ReportV2Route`) onu çizmez; RAP dilimi `hazir:true` yapınca adres kendiliğinden açılır.
 */
export const reportV2Routes: RouteObject[] = REPORT_CATALOG.filter((e) => e.nesil === "v2").map((e) => ({
  path: e.panelYolu,
  element: (
    <ProtectedRoute requirePermission={e.izin}>
      <ReportV2Route reportKey={e.key} />
    </ProtectedRoute>
  ),
}));

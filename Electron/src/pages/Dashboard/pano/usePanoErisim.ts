import { useCallback } from "react";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { isRouteModuleOpen } from "@/lib/route-modules";
import { reportKeyOfPath } from "@/lib/report-gate";
import { yolunu, type PanoTarget } from "./pano-hedefler";

export interface PanoErisim {
  /** İzin listesinden herhangi biri var mı. */
  hasAny: (izin: readonly string[]) => boolean;
  /** Hedef açılır mı: izin + yol modülü + rapor kapısı (`ProtectedRoute` ile aynı üç kapı). Bayrak yüklenmeden kapalı. */
  canGo: (h: PanoTarget) => boolean;
}

export function usePanoErisim(): PanoErisim {
  const { hasAnyPermission } = useRoleAccess();
  const ctx = useOperationsVisibilityContext();
  const hasAny = useCallback((izin: readonly string[]) => hasAnyPermission([...izin]), [hasAnyPermission]);
  const canGo = useCallback(
    (h: PanoTarget) => {
      if (!hasAny(h.izin) || !ctx.flagsReady) return false;
      const yol = yolunu(h.to);
      if (!isRouteModuleOpen(yol, ctx)) return false;
      const rapor = reportKeyOfPath(yol);
      return rapor === null || ctx.isReportOpen(rapor);
    },
    [hasAny, ctx],
  );
  return { hasAny, canGo };
}

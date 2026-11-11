// Bir hedef yol AÇILIR mı — `ProtectedRoute` ile aynı üç kapı: izin (herhangi biri) + yol modülü + rapor kapısı.
// Pano kısayolları ve kayıt sayfası sekmeleri/eylemleri aynı cevabı buradan okur (tek kaynak).
import { useCallback } from "react";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { isRouteModuleOpen } from "@/lib/route-modules";
import { reportKeyOfPath } from "@/lib/report-gate";

export interface RouteTarget {
  to: string;
  /** Bunlardan HERHANGİ biri (route'un `requirePermission`/`requireAnyPermission` listesi). */
  izin: readonly string[];
}

export interface RouteAccess {
  /** İzin listesinden herhangi biri var mı. */
  hasAny: (izin: readonly string[]) => boolean;
  /** Hedef açılır mı; bayraklar yüklenmeden KAPALI (fail-closed). */
  canGo: (h: RouteTarget) => boolean;
}

/** Sorgu dizgesi kapı ölçümüne girmez. */
export function pathOf(to: string): string {
  const i = to.indexOf("?");
  return i < 0 ? to : to.slice(0, i);
}

export function useRouteAccess(): RouteAccess {
  const { hasAnyPermission } = useRoleAccess();
  const ctx = useOperationsVisibilityContext();
  const hasAny = useCallback((izin: readonly string[]) => hasAnyPermission([...izin]), [hasAnyPermission]);
  const canGo = useCallback(
    (h: RouteTarget) => {
      if (!hasAny(h.izin) || !ctx.flagsReady) return false;
      const yol = pathOf(h.to);
      if (!isRouteModuleOpen(yol, ctx)) return false;
      const rapor = reportKeyOfPath(yol);
      return rapor === null || ctx.isReportOpen(rapor);
    },
    [hasAny, ctx],
  );
  return { hasAny, canGo };
}

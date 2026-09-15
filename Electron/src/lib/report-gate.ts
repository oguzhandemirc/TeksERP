// =============================================================================
// RAPOR GÖRÜNÜRLÜK KAPISI — panel tarafı SAF yüklemler (Raporlar K5)
// =============================================================================
// Görünürlük TEK LİSTEDİR: `reports.closedKeys` (backend `getFeatureFlags` →
// `reportsClosedKeys`). Karar tek yerde alınır (`useOperationsVisibilityContext`
// `isReportOpen`), üç yol aynı yüklemi okur: karo · route (`ProtectedRoute`) · palet.
//
// FAIL-CLOSED iki yönlü: liste OKUNAMADI (`null`: bozuk satır ya da henüz yüklenmedi)
// ⇒ hiçbir rapor açık değil; katalogda OLMAYAN anahtar ⇒ kapalı. "Boş liste" ile
// "liste yok" aynı şey DEĞİL — backend `null`ü bilerek ayırır.
// =============================================================================
import { REPORT_BY_KEY } from "@/lib/report-catalog";

/** `/reports/<kategori>/<rapor>[/...]` → `"<kategori>/<rapor>"`; kategori hub'ı ve rapor-dışı yol → `null`. */
export function reportKeyOfPath(pathname: string): string | null {
  const segs = pathname.split("/").filter((s) => s && !s.startsWith(":"));
  if (segs[0] !== "reports" || segs.length < 3) return null;
  return `${segs[1]}/${segs[2]}`;
}

/** Tek karar noktası — `useOperationsVisibilityContext` bunu `closedKeys` ile kapatır. */
export function isReportOpenWith(closedKeys: readonly string[] | null | undefined, key: string): boolean {
  if (closedKeys == null) return false; // null VE undefined: liste yoksa kapalı
  if (!REPORT_BY_KEY.has(key)) return false;
  return !closedKeys.includes(key);
}

/** Kategoride EN AZ bir açık rapor var mı — kategori karosu/palet başlığı buna bakar. */
export function categoryHasOpenReport(closedKeys: readonly string[] | null | undefined, category: string): boolean {
  if (closedKeys == null) return false;
  for (const key of REPORT_BY_KEY.keys()) {
    if (key.startsWith(`${category}/`) && isReportOpenWith(closedKeys, key)) return true;
  }
  return false;
}

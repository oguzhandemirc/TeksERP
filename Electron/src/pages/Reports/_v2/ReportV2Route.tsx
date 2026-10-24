import { Navigate } from "react-router-dom";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { REPORT_BY_KEY } from "@/lib/report-catalog";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { isCenterEntryVisible } from "./center-model";
import { ReportV2Page } from "./ReportV2Page";

/**
 * v2 yaprağının kapısı — `ProtectedRoute`un (izin · modül · rapor kapısı) ÜSTÜNE iki koşul:
 * bayrak açık ve satır çizilen (`hazir`). Merkez'de çizilmeyen satırın adresi de açılmaz.
 */
export function ReportV2Route({ reportKey }: { reportKey: string }) {
  const { isAdmin, hasPermission } = useRoleAccess();
  const ctx = useOperationsVisibilityContext();
  const entry = REPORT_BY_KEY.get(reportKey);
  // Bayrak bilinmiyorken yönlendirme yok (ProtectedRoute ile aynı ders: "bilinmiyor" ≠ "kapalı").
  if (!ctx.flagsReady) return null;
  if (!entry || !ctx.reportsV2Enabled || !isCenterEntryVisible(entry, { isAdmin, hasPermission, ctx })) {
    return <Navigate to="/forbidden" replace />;
  }
  return <ReportV2Page key={entry.key} entry={entry} />;
}

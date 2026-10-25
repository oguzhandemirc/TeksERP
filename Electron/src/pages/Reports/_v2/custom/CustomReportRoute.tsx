import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";

/** Özel rapor sayfalarının kapısı: `reportsV2Enabled` kapalıyken adres açılmaz (izin `ProtectedRoute`ta). */
export function CustomReportRoute({ children }: { children: ReactNode }) {
  const ctx = useOperationsVisibilityContext();
  // Bayrak bilinmiyorken yönlendirme yok ("bilinmiyor" ≠ "kapalı").
  if (!ctx.flagsReady) return null;
  if (!ctx.reportsV2Enabled) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
}

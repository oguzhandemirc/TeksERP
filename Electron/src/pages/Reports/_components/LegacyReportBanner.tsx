import { Link } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { legacyBannerModel } from "../_v2/legacy-model";

/**
 * Eski rapor sayfasının "yeni hâli" bandı — kendi kendini çizer, YALNIZ `ReportPageLayout`
 * (ve kendi adresi olmayan Cari Ekstre diyaloğu) bağlar. Otomatik yönlendirme YOK: eski
 * sayfa geçiş boyunca kendi başına çalışır, band yalnız yolu gösterir.
 */
export function LegacyReportBanner({ reportKey, className = "" }: { reportKey?: string; className?: string }) {
  const { isAdmin, hasPermission } = useRoleAccess();
  const ctx = useOperationsVisibilityContext();
  const model = legacyBannerModel(reportKey, { isAdmin, hasPermission, ctx });
  if (!model) return null;
  return (
    <div
      role="note"
      aria-label="Yeni hâli"
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-primary/20 bg-primary/5 px-4 py-2 text-sm ${className}`}
    >
      <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      {model.kind === "merged" ? (
        <>
          <span className="text-muted-foreground">Bu raporun yeni hâli:</span>
          <Link to={model.to} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            {model.targetTitle} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </>
      ) : (
        <>
          <span className="text-muted-foreground">Bu aracın yeni yeri: {model.place}.</span>
          <Link to={model.to} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            {model.hostLabel} ekranına git <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </>
      )}
    </div>
  );
}

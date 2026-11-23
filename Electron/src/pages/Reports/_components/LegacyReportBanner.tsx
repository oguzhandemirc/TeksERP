import { Link } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { cn } from "@/lib/utils";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { legacyBannerModel } from "../_v2/legacy-model";

/**
 * Eski rapor sayfasının "yeni hâli" bağlantısı — kendi kendini çizer, YALNIZ `ReportPageLayout` başlığına
 * bağlanır (akışta tam genişlik bant değil; kullanıcı 2026-11-23). Otomatik yönlendirme YOK.
 */
export function LegacyReportBanner({ reportKey, className = "" }: { reportKey?: string; className?: string }) {
  const { isAdmin, hasPermission } = useRoleAccess();
  const ctx = useOperationsVisibilityContext();
  const model = legacyBannerModel(reportKey, { isAdmin, hasPermission, ctx });
  if (!model) return null;
  const merged = model.kind === "merged";
  return (
    <span
      role="note"
      aria-label="Yeni hâli"
      title={merged ? undefined : `Bu aracın yeni yeri: ${model.place}.`}
      className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary/5 px-2.5 py-1 text-xs", className)}
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      {merged ? (
        <>
          <span className="text-muted-foreground">Bu raporun yeni hâli:</span>
          <Link to={model.to} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            {model.targetTitle} <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </>
      ) : (
        <>
          <span className="text-muted-foreground">Yeni yeri:</span>
          <Link to={model.to} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            {model.hostLabel} <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </>
      )}
    </span>
  );
}

import { Footprints } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { SYSTEM_ACTIVITY_ACCESS } from "@/lib/permissions";

// "İz sür" — kayıt kartından Etkinlik akışının İşlemler görünümüne, KAYIT NO
// aramasıyla (izlenebilirlik B3). Arama sunucuda: kayıt + aynı istekteki kardeşler.

/** Sunucu `q` < 2 karakteri 400 ile reddeder (activity-view MIN_QUERY_LENGTH). */
const MIN_NO = 2;

/** Etkinlik sayfası bu state anahtarını `useScanSeed` ile okur (açık sekmede de). */
export const ACTIVITY_QUERY_SEED = "activityQuery";

export function activityTraceTarget(recordNo: string): { to: string; state: Record<string, string> } {
  return { to: "/system/activity", state: { [ACTIVITY_QUERY_SEED]: recordNo.trim() } };
}

interface Props {
  /** Etkinlik aramasında BENZERSİZ çözülen numara (barkod, iş emri no…). */
  recordNo?: string | null;
  title?: string;
  className?: string;
}

export function TraceLink({ recordNo, title, className }: Props) {
  const { hasAnyPermission } = useRoleAccess();
  const no = recordNo?.trim();
  if (!no || no.length < MIN_NO || !hasAnyPermission(SYSTEM_ACTIVITY_ACCESS)) return null;
  return (
    <button
      type="button"
      data-testid="trace-link"
      title={title ?? `${no} için işlem geçmişi (Etkinlik → İşlemler)`}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1 text-xs font-medium text-primary underline-offset-2 hover:underline",
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        // Sekme deposu tıklamada yüklenir (AuditNarrativeRow ile aynı gerekçe).
        const target = activityTraceTarget(no);
        void import("@/components/layout/tabs/use-tab-target").then(({ openTargetNow }) =>
          openTargetNow("topLevel", target.to, undefined, target.state),
        );
      }}
    >
      <Footprints className="h-3.5 w-3.5" /> İz sür
    </button>
  );
}

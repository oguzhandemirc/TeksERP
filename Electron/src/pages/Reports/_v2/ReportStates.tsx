import { AlertTriangle, Lock, PowerOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { apiErrorText } from "@/lib/api-error";
import type { ReportFailure } from "./useReportV2";

/** Kapı hataları AYRI cümle: modül kapalı ≠ rapor kapatılmış ≠ yetki yok (kullanıcı kime gideceğini bilsin). */
export const FAILURE_TEXT: Record<Exclude<ReportFailure, "other">, { title: string; description: string }> = {
  "module-disabled": {
    title: "Bu raporun modülü bu kurulumda kapalı",
    description: "Modül açılınca rapor kendiliğinden görünür. Açmak için yöneticinize başvurun (Sistem → Modüller).",
  },
  "report-disabled": {
    title: "Bu rapor bu kurulumda kapatılmış",
    description: "Rapor görünürlüğünü yönetici değiştirebilir (Sistem → Modüller → Raporlar).",
  },
  forbidden: {
    title: "Bu raporu görme yetkiniz yok",
    description: "Rolünüze bu rapor alanının izni atanmamış. Gerekiyorsa yöneticinizden isteyin.",
  },
};

export function ReportFailureState({ failure, error, onRetry }: { failure: ReportFailure; error: unknown; onRetry: () => void }) {
  if (failure !== "other") {
    const t = FAILURE_TEXT[failure];
    return <EmptyState icon={failure === "forbidden" ? Lock : PowerOff} title={t.title} description={t.description} className="rounded-lg border" />;
  }
  return (
    <EmptyState
      icon={AlertTriangle}
      title="Rapor yüklenemedi"
      description={apiErrorText(error, "Sunucu raporu hazırlayamadı. Biraz sonra tekrar deneyin.")}
      className="rounded-lg border"
      action={
        <Button type="button" variant="outline" size="sm" className="mt-2 gap-1.5" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" /> Tekrar dene
        </Button>
      }
    />
  );
}

export function ReportLoadingState() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Rapor yükleniyor">
      <div className="grid gap-4 md:grid-cols-5">
        <Skeleton className="h-44 md:col-span-2" />
        <Skeleton className="h-44 md:col-span-3" />
      </div>
      <Skeleton className="h-72" />
      <Skeleton className="h-40" />
    </div>
  );
}

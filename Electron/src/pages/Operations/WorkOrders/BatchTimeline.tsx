import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { safeFormat } from "@/lib/format";
import { workOrderService, type BatchTimelineStep } from "./service";

/** RollOperationType → kısa Türkçe etiket. */
const OP_LABEL: Record<string, string> = {
  KURSUN_APPLIED: "Kurşun",
  QC2_COMPLETED: "KK2",
  TAMBUR_PROCESSED: "Tambur kararı",
  SUBCONTRACTOR_SENT: "Fasona sevk",
  SUBCONTRACTOR_RETURNED: "Fason dönüş",
};

/**
 * Parti rota-zaman çizelgesi — partinin TÜM adımlardaki (fason + iç) birleşik
 * yolculuğu: her adıma ne zaman girdi/çıktı, kaç top, hangi operasyonlar (kurşun/
 * QC2/tambur/fason). Veriyi TEK istekte parti-bazlı endpoint'ten çeker (per-top
 * N istek yerine). Yalnız modal açıkken (`enabled`) sorgular.
 */
export function BatchTimeline({
  workOrderId,
  batchId,
  enabled,
}: {
  workOrderId: string;
  batchId: string;
  enabled: boolean;
}) {
  const q = useQuery({
    queryKey: ["batch-timeline", workOrderId, batchId],
    queryFn: () => workOrderService.getBatchTimeline(workOrderId, batchId),
    enabled: enabled && Boolean(workOrderId && batchId),
    staleTime: 60_000,
  });

  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  const steps = q.data?.data?.steps ?? [];
  if (steps.length === 0) {
    return <div className="text-[11px] italic text-muted-foreground">Rota adımı bulunamadı.</div>;
  }

  return (
    <ol className="relative space-y-3 pl-5">
      <span className="absolute bottom-1 left-[7px] top-1 w-px bg-border" aria-hidden />
      {steps.map((s) => (
        <TimelineStep key={s.stepId} step={s} />
      ))}
    </ol>
  );
}

function TimelineStep({ step }: { step: BatchTimelineStep }) {
  const isFason = step.stationType === "EXTERNAL";
  return (
    <li className="relative">
      <span
        className={cn(
          "absolute -left-5 top-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-background",
          step.visited ? "bg-primary" : "bg-muted-foreground/30",
        )}
        aria-hidden
      />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs font-semibold">{step.stationName}</span>
        {isFason && (
          <span className="rounded bg-warning/10 px-1 text-[9px] font-medium text-warning">
            Fason
          </span>
        )}
        {step.visited ? (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {step.enteredAt && safeFormat(step.enteredAt, "dd.MM · HH:mm")}
            {step.exitedAt && ` → ${safeFormat(step.exitedAt, "dd.MM · HH:mm")}`}
            {step.rollCount > 0 && ` · ${step.rollCount} top`}
          </span>
        ) : (
          <span className="text-[10px] italic text-muted-foreground">bekliyor</span>
        )}
      </div>
      {step.operations.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {step.operations.map((op) => (
            <span
              key={op.type}
              className="inline-flex items-center gap-1 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px]"
              title={[op.operators.join(", "), safeFormat(op.lastAt, "dd.MM.yyyy · HH:mm")]
                .filter(Boolean)
                .join(" · ")}
            >
              {OP_LABEL[op.type] ?? op.type}
              {op.count > 1 && <span className="text-muted-foreground">×{op.count}</span>}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

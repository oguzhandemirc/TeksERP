import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { workOrderService, type BatchLane, type BatchDispatchStatus } from "./service";
import type { WorkOrderStepLite } from "./types";

type Status = BatchDispatchStatus;

/** Partinin o adımda BULUNDUĞU (current) hücre rengi — türetilmiş duruma göre. */
const CUR_CELL: Record<Status, string> = {
  OPEN: "bg-warning text-white",
  PARTIAL: "bg-primary text-primary-foreground",
  RETURNED: "bg-success text-white",
  CANCELLED: "bg-muted-foreground/40 text-foreground",
  DIRECT_SHIPPED: "bg-primary text-primary-foreground",
};
const DOT: Record<Status, string> = {
  OPEN: "bg-warning",
  PARTIAL: "bg-primary",
  RETURNED: "bg-success",
  CANCELLED: "bg-muted-foreground",
  DIRECT_SHIPPED: "bg-primary",
};

/**
 * Partinin lane-Gantt durumu (yalnız hücre rengi için): açık sevki varsa fasonda
 * (OPEN), kısmi dönüşteyse PARTIAL, tümü döndü/sevkedildi ise RETURNED; hiç sevki
 * olmayan (fabrika-içi akan) parti PARTIAL (üretimde) sayılır.
 */
function batchDisplayStatus(b: BatchLane): Status {
  if (b.dispatches.some((d) => d.status === "OPEN")) return "OPEN";
  if (b.dispatches.some((d) => d.status === "PARTIAL")) return "PARTIAL";
  if (b.dispatches.some((d) => d.status === "DIRECT_SHIPPED")) return "DIRECT_SHIPPED";
  if (b.dispatches.length > 0 && b.dispatches.every((d) => d.status === "CANCELLED")) {
    return "CANCELLED";
  }
  if (b.dispatches.length > 0) return "RETURNED";
  return "PARTIAL";
}

/**
 * Parti swimlane-Gantt: satır = parti (Batch), sütun = rota adımı (+ terminal
 * "Depo"). Her partinin malı hangi sütundaysa o hücre vurgulanır; fason sevk
 * adımı (origin) ile mevcut konum arası "geçildi" olarak dolar. Böylece "1. parti
 * depoya ulaşmış, 2. parti hâlâ boyahanede" tek bakışta okunur.
 *
 * Konum→sütun eşleşmesi istasyon ADI ile yapılır (getBranches `currentPositions`
 * label'ı istasyon adı ya da "Depo"/"Stok"); eşleşmeyen terminal etiketler Depo
 * sütununa düşer.
 */
export function BranchGantt({
  workOrderId,
  steps,
}: {
  workOrderId: string;
  steps: WorkOrderStepLite[];
}) {
  const q = useQuery({
    queryKey: ["work-order-branches", workOrderId],
    queryFn: () => workOrderService.getBranches(workOrderId),
    enabled: Boolean(workOrderId),
    staleTime: 60_000,
  });

  const batches = q.data?.data?.batches ?? [];
  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  if (batches.length === 0) return null;

  const stepNames = steps.map((s) => s.station?.name ?? "—");
  const columns = [...stepNames, "Depo"];
  const depoIdx = columns.length - 1;
  const colForLabel = (label: string) => {
    const i = stepNames.indexOf(label);
    return i >= 0 ? i : depoIdx;
  };
  const gridCols = `minmax(120px,150px) repeat(${columns.length}, minmax(56px,1fr))`;

  return (
    <div className="overflow-x-auto rounded-md border p-2">
      <div className="min-w-[460px] space-y-1">
        {/* başlık */}
        <div className="grid items-end gap-1" style={{ gridTemplateColumns: gridCols }}>
          <div />
          {columns.map((c, i) => (
            <div
              key={i}
              className="px-0.5 pb-1 text-center text-[10px] font-medium leading-tight text-muted-foreground"
            >
              {c}
            </div>
          ))}
        </div>

        {/* satırlar (partiler) */}
        {batches.map((b) => {
          const status = batchDisplayStatus(b);
          // Origin = partinin (ilk) fason sevk adımı; sevki yoksa ilk adımdan başlar.
          const dispatchStepName = b.dispatches.find((d) => d.stepName)?.stepName ?? "";
          const originIdx = Math.max(0, stepNames.indexOf(dispatchStepName));
          const posByCol = new Map<number, { count: number; meters: number }>();
          for (const p of b.currentPositions) {
            const ci = colForLabel(p.label);
            const cur = posByCol.get(ci) ?? { count: 0, meters: 0 };
            cur.count += p.count;
            cur.meters += p.totalMeters;
            posByCol.set(ci, cur);
          }
          const curCols = [...posByCol.keys()];
          const maxCur = curCols.length ? Math.max(...curCols) : originIdx;

          return (
            <div
              key={b.batchId}
              className="grid items-center gap-1"
              style={{ gridTemplateColumns: gridCols }}
            >
              <div className="flex min-w-0 items-center gap-1.5 pr-1">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[status])} />
                <span className="truncate font-mono text-[11px]">{b.batchNumber}</span>
              </div>
              {columns.map((_, ci) => {
                const pos = posByCol.get(ci);
                const isCurrent = pos != null;
                const isPassed = ci >= originIdx && ci <= maxCur && !isCurrent;
                return (
                  <div key={ci} className="px-0.5">
                    <div
                      className={cn(
                        "flex h-9 flex-col items-center justify-center gap-0 rounded leading-tight tabular-nums",
                        isCurrent
                          ? cn("font-semibold", CUR_CELL[status])
                          : isPassed
                            ? "bg-muted text-muted-foreground"
                            : "bg-transparent",
                      )}
                      title={
                        isCurrent
                          ? `${columns[ci]}: ${pos!.count} top · ${formatNumber(pos!.meters, 0)} m`
                          : undefined
                      }
                    >
                      {isCurrent ? (
                        <>
                          <span className="text-[8.5px]">{pos!.count} top</span>
                          <span className="text-[8.5px] opacity-90">
                            {formatNumber(pos!.meters, 0)} m
                          </span>
                        </>
                      ) : isPassed ? (
                        <span className="text-[11px] opacity-40">·</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

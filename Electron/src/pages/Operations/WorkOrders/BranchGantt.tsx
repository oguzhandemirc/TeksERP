import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { workOrderService, type BatchLane, type BatchDispatchStatus } from "./service";
import type { WorkOrderStepLite } from "./types";

type Status = BatchDispatchStatus;

/** Partinin o adımda BULUNDUĞU (current) hücre stili — v3 paleti (`.wo-v3` var'ları). */
const CUR_STYLE: Record<Status, CSSProperties> = {
  OPEN: { background: "var(--warn)", color: "#fff" },
  PARTIAL: { background: "var(--accent)", color: "#fff" },
  RETURNED: { background: "var(--ok)", color: "#fff" },
  CANCELLED: { background: "var(--surface-2)", color: "var(--ink-2)" },
  DIRECT_SHIPPED: { background: "var(--accent)", color: "#fff" },
};
const DOT_COLOR: Record<Status, string> = {
  OPEN: "var(--warn)",
  PARTIAL: "var(--accent)",
  RETURNED: "var(--ok)",
  CANCELLED: "var(--faint)",
  DIRECT_SHIPPED: "var(--accent)",
};

const PASSED_STYLE: CSSProperties = {
  background: "color-mix(in srgb, var(--ink) 15%, transparent)",
  color: "var(--ink-2)",
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
 * depoya ulaşmış, 2. parti hâlâ boyahanede" tek bakışta okunur. Renkler v3 paleti
 * (`.wo-v3` altında; başka yerde kullanılmaz).
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

  // Boş (top kalmamış) partiler Gantt'ta gösterilmez — anlık konumları yok.
  const batches = (q.data?.data?.batches ?? []).filter((b) => b.rollCount > 0);
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
    <div className="card" style={{ overflowX: "auto", padding: "8px 10px" }}>
      <div className="min-w-[460px] space-y-1">
        {/* başlık */}
        <div className="grid items-end gap-1" style={{ gridTemplateColumns: gridCols }}>
          <div />
          {columns.map((c, i) => (
            <div
              key={i}
              className="px-0.5 pb-1 text-center text-[10px] font-medium leading-tight"
              style={{ color: "var(--muted)" }}
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
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: DOT_COLOR[status] }}
                />
                <span
                  className="truncate font-mono text-[12px] font-bold tracking-tight"
                  style={{ color: "var(--ink)" }}
                >
                  {b.batchNumber}
                </span>
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
                        isCurrent && "font-semibold",
                      )}
                      style={
                        isCurrent ? CUR_STYLE[status] : isPassed ? PASSED_STYLE : undefined
                      }
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
                        <span className="text-[13px]" style={{ opacity: 0.8 }}>
                          ·
                        </span>
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

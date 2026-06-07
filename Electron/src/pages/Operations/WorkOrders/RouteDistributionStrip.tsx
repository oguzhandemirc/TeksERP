import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { stepState, STEP_STATE_DOT, STEP_STATE_LABEL, type StepState } from "./step-state";
import type { WorkOrderStepLite } from "./types";

/** Numaralı daire içindeki rakamın okunur renk eşlemesi (statü zeminine göre). */
const CIRCLE_TEXT: Record<StepState, string> = {
  active: "text-primary-foreground",
  passed: "text-white",
  skipped: "text-foreground/70",
  waiting: "text-foreground/60",
};

interface Props {
  /** stepSequence'e göre sıralı adımlar (findById response'u). */
  steps: WorkOrderStepLite[];
  className?: string;
  /** compact = slide-over peek (sıkı); detailed = tam sayfa (ferah, WIP top/m alt alta). */
  variant?: "compact" | "detailed";
}

/**
 * Rota dağılım şeridi — etiketli yatay stepper.
 *
 * Her adım: numaralı daire (statü rengi) + istasyon adı + o adımda ŞU AN bekleyen
 * malın (WIP) rozeti (top + metre). Aynı iş emrinde birden çok dal farklı
 * adımlarda olunca her adım kendi WIP rozetiyle görünür → tek bakışta "mal nerede".
 * Tek-statü "buradayız" oku değil; bağlantı çizgileri NÖTR (geçildi/akış hikâyesi
 * Gantt'ta). Statü etiketi (Geçildi/Atlandı/Bekliyor) yalnızca WIP'siz adımlarda.
 */
export function RouteDistributionStrip({ steps, className, variant = "detailed" }: Props) {
  if (steps.length === 0) return null;
  const compact = variant === "compact";

  return (
    <div className={cn("flex items-start", compact ? "gap-0.5" : "gap-1", className)}>
      {steps.map((step, i) => {
        const wip = step.currentRolls;
        const wipCount = wip?.count ?? 0;
        const hasWip = wipCount > 0;
        const state = stepState(step);
        const isFirst = i === 0;
        const isLast = i === steps.length - 1;

        return (
          <div key={step.id} className="flex flex-1 flex-col items-center gap-1">
            {/* Numaralı daire + yarım bağlantı çizgileri (soldaki=öncekine, sağdaki=sonrakine) */}
            <div className="flex w-full items-center">
              <span className={cn("h-0.5 flex-1 rounded", isFirst ? "bg-transparent" : "bg-border")} />
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-full font-bold leading-none",
                  compact ? "h-4 w-4 text-[8px]" : "h-5 w-5 text-[9px]",
                  STEP_STATE_DOT[state],
                  CIRCLE_TEXT[state],
                )}
              >
                {step.stepSequence}
              </span>
              <span className={cn("h-0.5 flex-1 rounded", isLast ? "bg-transparent" : "bg-border")} />
            </div>

            {/* İstasyon adı */}
            <span
              className={cn(
                "max-w-full text-balance px-0.5 text-center font-medium leading-tight",
                compact ? "text-[9px]" : "text-[10px]",
              )}
              title={step.station?.name ?? undefined}
            >
              {step.station?.name ?? "—"}
            </span>

            {/* WIP rozeti (mal varsa) veya statü etiketi */}
            {hasWip ? (
              compact ? (
                <span className="rounded bg-primary/10 px-1 text-[8px] font-semibold leading-tight tabular-nums text-primary">
                  {wipCount} top · {formatNumber(wip!.totalMeters, 0)} m
                </span>
              ) : (
                <span className="flex flex-col items-center rounded bg-primary/10 px-1.5 py-0.5 leading-tight tabular-nums text-primary">
                  <span className="text-[9px] font-semibold">{wipCount} top</span>
                  <span className="text-[9px]">{formatNumber(wip!.totalMeters, 0)} m</span>
                </span>
              )
            ) : (
              <span className={cn("text-muted-foreground", compact ? "text-[8px]" : "text-[9px]")}>
                {STEP_STATE_LABEL[state]}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

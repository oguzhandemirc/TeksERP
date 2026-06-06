import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { stepState, STEP_STATE_DOT, STEP_STATE_LABEL } from "./step-state";
import type { WorkOrderStepLite } from "./types";

interface Props {
  /** stepSequence'e göre sıralı adımlar (findById response'u). */
  steps: WorkOrderStepLite[];
  className?: string;
}

/**
 * Rota dağılım şeridi.
 *
 * Eski şerit her adımı tek statülü bir "buradayız" oku gibi gösteriyordu —
 * aynı iş emrinde birden çok dal (parti) farklı adımlarda olunca yanıltıcıydı
 * (ör. 1. parti Kurşun'da bitmiş görünürken 2. parti hâlâ Fason'da). Bunun
 * yerine her adımı, o adımda ŞU AN bekleyen malın (WIP) dağılımı olarak
 * gösterir: malı olan her adım kendi sayaç rozetini taşır, böylece iki dal
 * aynı anda tek bakışta görünür. Statü (geçildi/atlandı/bekliyor) yalnızca
 * WIP'i olmayan adımlar için ikincil ipucu olarak kullanılır.
 */
export function RouteDistributionStrip({ steps, className }: Props) {
  if (steps.length === 0) return null;

  return (
    <div className={cn("flex items-center gap-1 px-1", className)}>
      {steps.map((step, i) => {
        const wip = step.currentRolls;
        const wipCount = wip?.count ?? 0;
        const hasWip = wipCount > 0;
        const state = stepState(step);
        const isLast = i === steps.length - 1;

        const stateLabel = hasWip
          ? `Şu an: ${wipCount} parça · ${formatNumber(wip!.totalMeters, 0)} m`
          : STEP_STATE_LABEL[state];
        const title = `${step.station?.name ?? "—"} · ${stateLabel}`;

        return (
          <div
            key={step.id}
            className={cn(
              "flex items-center gap-1",
              isLast ? "flex-none" : "flex-1",
            )}
            title={title}
          >
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", STEP_STATE_DOT[state])} />
            {hasWip && (
              <span className="shrink-0 rounded-full bg-primary/10 px-1 text-[9px] font-semibold leading-4 tabular-nums text-primary">
                {wipCount}
              </span>
            )}
            {/* Çizgi nötr — "geçildi/akış" hikâyesi Gantt'ta; burada yanıltmasın. */}
            {!isLast && <span className="h-0.5 flex-1 rounded bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

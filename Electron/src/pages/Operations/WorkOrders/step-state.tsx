import { cn } from "@/lib/utils";
import type { WorkOrderStepLite } from "./types";

/**
 * Bir rota adımının GÖRÜNÜM durumu — ham `step.status` (tek-pointer, çoklu-dalda
 * yanıltıcı) yerine WIP-öncelikli türetilir:
 *  - mal şu an buradaysa → "active" (İşlemde)   ← statü ne olursa olsun öncelikli
 *  - değilse COMPLETED   → "passed"  (Geçildi)
 *  - değilse SKIPPED     → "skipped" (Atlandı)
 *  - aksi                → "waiting" (Bekliyor)
 * Böylece "Tamamlandı ama 2 parça burada" gibi çelişki olmaz.
 */
export type StepState = "active" | "passed" | "skipped" | "waiting";

export function stepState(step: WorkOrderStepLite): StepState {
  if ((step.currentRolls?.count ?? 0) > 0) return "active";
  if (step.status === "COMPLETED") return "passed";
  if (step.status === "SKIPPED") return "skipped";
  return "waiting";
}

export const STEP_STATE_LABEL: Record<StepState, string> = {
  active: "İşlemde",
  passed: "Geçildi",
  skipped: "Atlandı",
  waiting: "Bekliyor",
};

/** Şeritteki nokta rengi. */
export const STEP_STATE_DOT: Record<StepState, string> = {
  active: "bg-primary ring-2 ring-primary/30",
  passed: "bg-success",
  skipped: "bg-muted-foreground/40",
  waiting: "bg-muted-foreground/20",
};

const BADGE_CLS: Record<StepState, string> = {
  active: "border-primary/40 bg-primary/10 text-primary",
  passed: "border-success/40 bg-success/10 text-success",
  skipped: "border-border bg-muted text-muted-foreground",
  waiting: "border-border bg-muted/50 text-muted-foreground",
};

export function StepStateBadge({
  step,
  className,
}: {
  step: WorkOrderStepLite;
  className?: string;
}) {
  const s = stepState(step);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
        BADGE_CLS[s],
        className,
      )}
    >
      {STEP_STATE_LABEL[s]}
    </span>
  );
}

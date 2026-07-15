import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { stepState, STEP_STATE_LABEL } from "../step-state";
import type { WorkOrderStepLite } from "../types";

/**
 * v3 rota şeridi — numaralı daire-node'lar + konnektör. Durum WIP-öncelikli
 * (step-state): mal orada → active (accent), geçildi → done (koyu), aksi bekliyor.
 * Mal olan adımda WIP rozeti (top · m), yoksa durum etiketi.
 */
export function RouteStepline({ steps }: { steps: WorkOrderStepLite[] }) {
  return (
    <div className="card steps">
      <div className="stepline">
        {steps.map((step) => {
          const state = stepState(step);
          const wip = step.currentRolls;
          const hasWip = (wip?.count ?? 0) > 0;
          return (
            <div
              key={step.id}
              className={cn("step", state === "passed" && "done", state === "active" && "active")}
            >
              <span className="conn" />
              <div className="node">{step.stepSequence}</div>
              <div className="nm">{step.station?.name ?? "—"}</div>
              {hasWip ? (
                <div className="wip num">
                  {wip!.count} top · {formatNumber(wip!.totalMeters, 0)} m
                </div>
              ) : (
                <div className="st">{STEP_STATE_LABEL[state]}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

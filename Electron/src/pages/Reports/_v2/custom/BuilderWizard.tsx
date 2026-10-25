import { useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CatalogCube } from "./custom-api";
import { BUILDER_STEPS, stepReady, type BuilderState } from "./builder-model";
import { BuilderStepPanel } from "./BuilderStepPanel";

interface Props {
  state: BuilderState;
  cubes: readonly CatalogCube[];
  onChange: (next: BuilderState) => void;
}

/** Adım çubuğu: küp → ölçüler → boyutlar → süzgeçler → dönem/kıyas; önceki adım tamamsa ileri. */
export function BuilderWizard({ state, cubes, onChange }: Props) {
  const [step, setStep] = useState(0);
  const reachable = (i: number) => BUILDER_STEPS.slice(0, i).every((_, j) => stepReady(state, j));
  const last = BUILDER_STEPS.length - 1;
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <ol className="flex flex-wrap gap-2" aria-label="Oluşturma adımları">
        {BUILDER_STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              disabled={!reachable(i)}
              onClick={() => setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-50",
                i === step ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
              )}
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-background/20 text-[10px]">
                {i < step && stepReady(state, i) ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {label}
            </button>
          </li>
        ))}
      </ol>
      <BuilderStepPanel step={step} state={state} cubes={cubes} onChange={onChange} />
      <div className="flex justify-between gap-2 border-t pt-3">
        <Button type="button" variant="outline" size="sm" className="gap-1" disabled={step === 0} onClick={() => setStep(step - 1)}>
          <ChevronLeft className="h-4 w-4" /> Geri
        </Button>
        <Button type="button" size="sm" className="gap-1" disabled={step === last || !stepReady(state, step)} onClick={() => setStep(step + 1)}>
          İleri <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

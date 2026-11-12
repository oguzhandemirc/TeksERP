import type { UseFormReturn } from "react-hook-form";
import { FormField } from "@/components/forms/FormField";
import { CollapsibleFormSection } from "@/components/forms/CollapsibleFormSection";
import { Input } from "@/components/ui/input";
import type { MachineFormValues } from "./schema";
import { MACHINE_PLANNING_KEYS } from "./machinePayload";

/** Tezgâh planlama alanları — az kullanılır, kapalı gelir; dolu değer ya da hata varsa açık. */
export function MachinePlanningSection({ form, hasSavedValues }: { form: UseFormReturn<MachineFormValues>; hasSavedValues: boolean }) {
  const err = form.formState.errors;
  const hasError = MACHINE_PLANNING_KEYS.some((k) => Boolean(err[k]));
  return (
    <CollapsibleFormSection title="Planlama" defaultOpen={hasSavedValues} forceOpen={hasError} testId="machine-planning">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label="Devir (dk)" htmlFor="planRpm" error={err.planRpm}>
          <Input id="planRpm" inputMode="numeric" placeholder="600" {...form.register("planRpm")} />
        </FormField>
        <FormField label="Verim (%)" htmlFor="planEfficiencyPct" error={err.planEfficiencyPct}>
          <Input id="planEfficiencyPct" inputMode="decimal" placeholder="85" {...form.register("planEfficiencyPct")} />
        </FormField>
        <FormField label="En geniş çalışma eni (cm)" htmlFor="maxWorkingWidthCm" error={err.maxWorkingWidthCm}>
          <Input id="maxWorkingWidthCm" inputMode="decimal" placeholder="340" {...form.register("maxWorkingWidthCm")} />
        </FormField>
      </div>
    </CollapsibleFormSection>
  );
}

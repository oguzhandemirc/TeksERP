import { CrudPage } from "@/components/layout/CrudPage";
import { machineColumns } from "./columns";
import { machineService } from "./service";
import { MachineFormDialog } from "./MachineFormDialog";
import type { Machine } from "./types";
import type { MachineFormValues } from "./schema";

const buildPayload = (v: MachineFormValues, initial: Machine | null): Partial<Machine> => ({
  stationId: v.stationId,
  // Kod backend'de üretilir (MAK+GGAAYY+NNNN); create'te gönderilmez, edit'te korunur.
  ...(initial?.code ? { code: initial.code } : {}),
  name: v.name,
  // Devere Faz 3: yuva sayısı — allowlist satırı (istek gövdesini elle kuran katman).
  warpBeamSlots: v.warpBeamSlots,
});

export function MachinesPage() {
  return (
    <CrudPage<Machine>
      title="Makineler"
      description="İstasyonlardaki makine envanteri."
      entityName="Makine"
      importEntity="machine"
      queryKey="machines"
      service={machineService}
      columns={machineColumns}
      writePermission="station:write"
      searchPlaceholder="Kod veya ad ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <MachineFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) => onSubmit(buildPayload(values, initial))}
        />
      )}
    />
  );
}

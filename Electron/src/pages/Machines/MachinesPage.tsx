import { CrudPage } from "@/components/layout/CrudPage";
import { generateCode, CODE_PREFIXES } from "@/lib/code-generator";
import { machineColumns } from "./columns";
import { machineService } from "./service";
import { MachineFormDialog } from "./MachineFormDialog";
import type { Machine } from "./types";
import type { MachineFormValues } from "./schema";

const buildPayload = (v: MachineFormValues, initial: Machine | null): Partial<Machine> => ({
  stationId: v.stationId,
  code: initial?.code ?? generateCode(CODE_PREFIXES.MACHINE),
  name: v.name,
  deviceIp: v.deviceIp || null,
  isActive: v.isActive,
});

export function MachinesPage() {
  return (
    <CrudPage<Machine>
      title="Makineler"
      description="İstasyonlardaki makine envanteri."
      entityName="Makine"
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

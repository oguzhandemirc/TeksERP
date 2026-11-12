import { CrudPage } from "@/components/layout/CrudPage";
import { machineColumns } from "./columns";
import { machineService } from "./service";
import { MachineFormDialog } from "./MachineFormDialog";
import type { Machine } from "./types";
import { buildMachinePayload } from "./machinePayload";

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
      searchHint="Kod veya ad"
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <MachineFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) => onSubmit(buildMachinePayload(values, initial))}
        />
      )}
    />
  );
}

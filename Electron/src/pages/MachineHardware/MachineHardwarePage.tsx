import { CrudPage } from "@/components/layout/CrudPage";
import { machineHardwareColumns } from "./columns";
import { machineHardwareService } from "./service";
import { MachineHardwareFormDialog } from "./MachineHardwareFormDialog";
import type { MachineHardware } from "./types";
import { buildMachineHardwarePayload } from "./schema";

/**
 * Saha #cihaz: Makine Donanımı — sahadaki yazıcı + RS232 ara cihaz bilgileri +
 * gelen veriyi çözen regex desenleri. "Nerede ne kullanmışız" dokümantasyonu +
 * cihaz/kodlama değişince koda dokunmadan seçimle (desen) güncelleme.
 */
export function MachineHardwarePage() {
  return (
    <CrudPage<MachineHardware>
      title="Makine Donanımı"
      description="Sahadaki yazıcı + RS232 ara cihaz bilgileri (MAC) ve veri çözen regex desenleri."
      entityName="Makine Donanımı"
      queryKey="machine-hardware"
      service={machineHardwareService}
      columns={machineHardwareColumns}
      writePermission="station:write"
      searchPlaceholder="Yazıcı/MAC ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <MachineHardwareFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) => onSubmit(buildMachineHardwarePayload(values) as Partial<MachineHardware>)}
        />
      )}
    />
  );
}

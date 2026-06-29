import { CrudPage } from "@/components/layout/CrudPage";
import { peripheralColumns } from "./columns";
import { peripheralService } from "./service";
import { PeripheralDeviceFormDialog } from "./PeripheralDeviceFormDialog";
import { buildPeripheralPayload } from "./schema";
import type { PeripheralDevice } from "./types";

/**
 * Cihaz Kaydı — birleşik yazıcı + tekstil makine sinyal kaydı. Her cihaz dil
 * (model/override), format profili ve per-kind şablon yönlendirmesini taşır;
 * baskı anında backend cihaz→{dil,profil,şablon} çözer. Mobil BT yazıcılar
 * sahada otomatik kaydolur (register-bt); buradan da yönetilir.
 */
export function PeripheralDevicesPage() {
  return (
    <CrudPage<PeripheralDevice>
      title="Cihaz Kaydı"
      description="Yazıcılar (ağ/Bluetooth/USB/seri) + kantar/metraj sinyal kaynakları. Dil/profil/şablon yönlendirmesi."
      entityName="Cihaz"
      queryKey="peripherals"
      service={peripheralService}
      columns={peripheralColumns}
      writePermission="station:write"
      searchPlaceholder="Ad / kod / adres ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <PeripheralDeviceFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) => onSubmit(buildPeripheralPayload(values) as Partial<PeripheralDevice>)}
        />
      )}
    />
  );
}

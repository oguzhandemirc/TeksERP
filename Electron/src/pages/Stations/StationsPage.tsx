import { CrudPage } from "@/components/layout/CrudPage";
import { generateCode, CODE_PREFIXES } from "@/lib/code-generator";
import { stationColumns } from "./columns";
import { stationService } from "./service";
import { StationFormDialog } from "./StationFormDialog";
import type { Station } from "./types";
import type { StationFormValues } from "./schema";

const buildPayload = (v: StationFormValues, initial: Station | null): Partial<Station> => ({
  code: initial?.code ?? generateCode(CODE_PREFIXES.STATION),
  name: v.name,
  type: v.type,
  kind: v.kind,
  department: v.department || null,
  isActive: v.isActive,
});

export function StationsPage() {
  return (
    <CrudPage<Station>
      title="İstasyonlar"
      description="Üretim istasyonları, fason birimleri, paketleme/sevkiyat noktaları."
      entityName="İstasyon"
      queryKey="stations"
      service={stationService}
      columns={stationColumns}
      writePermission="station:write"
      searchPlaceholder="Kod, ad veya departman ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <StationFormDialog
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

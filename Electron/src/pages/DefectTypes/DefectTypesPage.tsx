import { CrudPage } from "@/components/layout/CrudPage";
import { defectTypeColumns } from "./columns";
import { defectTypeService } from "./service";
import { DefectTypeFormDialog } from "./DefectTypeFormDialog";
import type { DefectType } from "./types";
import type { DefectTypeFormValues } from "./schema";

const buildPayload = (
  v: DefectTypeFormValues,
  initial: DefectType | null,
): Partial<DefectType> => ({
  // Kod backend'de üretilir (HATA+GGAAYY+NNNN); create'te gönderilmez, edit'te korunur.
  ...(initial?.code ? { code: initial.code } : {}),
  name: v.name,
  description: v.description || null,
  severity: (v.severity || null) as DefectType["severity"],
  isActive: v.isActive,
});

export function DefectTypesPage() {
  return (
    <CrudPage<DefectType>
      title="Hata Tipleri"
      description="Kalite kontrol hata tanımları."
      entityName="Hata tipi"
      importEntity="defectType"
      queryKey="defect-types"
      service={defectTypeService}
      columns={defectTypeColumns}
      writePermission="quality:write"
      searchPlaceholder="Kod veya ad ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <DefectTypeFormDialog
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

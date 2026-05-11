import { CrudPage } from "@/components/layout/CrudPage";
import { generateCode } from "@/lib/code-generator";
import { fabricPropertyColumns } from "./columns";
import { fabricPropertyService } from "./service";
import { FabricPropertyFormDialog } from "./FabricPropertyFormDialog";
import type { FabricProperty } from "./types";
import type { FabricPropertyFormValues } from "./schema";

const buildPayload = (
  v: FabricPropertyFormValues,
  initial: FabricProperty | null,
): Partial<FabricProperty> => ({
  code: initial?.code ?? generateCode("OZL"),
  name: v.name,
  category: v.category?.trim() || null,
  description: v.description?.trim() || null,
  color: v.color?.trim() || null,
  sortOrder: v.sortOrder,
  isActive: v.isActive,
});

export function FabricPropertiesPage() {
  return (
    <CrudPage<FabricProperty>
      title="Kumaş Özellikleri"
      description="Yanmazlık, su geçirmezlik gibi kumaş kazanımları."
      entityName="Özellik"
      queryKey="fabric-properties"
      service={fabricPropertyService}
      columns={fabricPropertyColumns}
      writePermission="property:write"
      searchPlaceholder="Ad veya kategori ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <FabricPropertyFormDialog
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

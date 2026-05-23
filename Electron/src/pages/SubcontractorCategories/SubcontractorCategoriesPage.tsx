import { CrudPage } from "@/components/layout/CrudPage";
import { generateCode } from "@/lib/code-generator";
import { subcontractorCategoryColumns } from "./columns";
import { subcontractorCategoryService } from "./service";
import { SubcontractorCategoryFormDialog } from "./SubcontractorCategoryFormDialog";
import type { SubcontractorCategory } from "./types";
import type { SubcontractorCategoryFormValues } from "./schema";

const buildPayload = (
  v: SubcontractorCategoryFormValues,
  initial: SubcontractorCategory | null,
): Partial<SubcontractorCategory> => ({
  code: initial?.code ?? generateCode("KAT"),
  name: v.name,
  description: v.description?.trim() || null,
  isActive: v.isActive,
  appliesColor: v.appliesColor,
  appliesProperty: v.appliesProperty,
});

export function SubcontractorCategoriesPage() {
  return (
    <CrudPage<SubcontractorCategory>
      title="Fason Kategorileri"
      description="Boyahane, Baskı, Yıkama, Şardon gibi fason hizmet türleri."
      entityName="Kategori"
      queryKey="subcontractor-categories"
      service={subcontractorCategoryService}
      columns={subcontractorCategoryColumns}
      writePermission="subcontractor:write"
      searchPlaceholder="Ad ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <SubcontractorCategoryFormDialog
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

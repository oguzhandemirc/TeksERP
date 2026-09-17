import { CrudPage } from "@/components/layout/CrudPage";
import { generateCode } from "@/lib/code-generator";
import { subcontractorColumns } from "./columns";
import { subcontractorService } from "./service";
import { SubcontractorFormDialog } from "./SubcontractorFormDialog";
import type { Subcontractor } from "./types";
import type { SubcontractorFormValues } from "./schema";

interface BackendPayload {
  code: string;
  name: string;
  taxNumber: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  isFavorite: boolean;
  documentProfileId: string | null;
  categoryIds: string[];
  customerId: string;
}

export const buildSubcontractorPayload = (
  v: SubcontractorFormValues,
  initial: Subcontractor | null,
): BackendPayload => ({
  code: initial?.code ?? generateCode("FSN"),
  name: v.name,
  taxNumber: v.taxNumber?.trim() || null,
  phone: v.phone?.trim() || null,
  address: v.address?.trim() || null,
  isActive: v.isActive,
  isFavorite: v.isFavorite,
  documentProfileId: v.documentProfileId ?? null,
  categoryIds: v.categoryIds,
  customerId: v.customerId,
});

export function SubcontractorsPage() {
  return (
    <CrudPage<Subcontractor>
      title="Fason Firmalar"
      description="Boyahane, baskı, yıkama gibi dış hizmet sağlayan firmalar."
      entityName="Fason firma"
      mergeEntity="subcontractor"
      importEntity="subcontractor"
      queryKey="subcontractors"
      service={subcontractorService}
      columns={subcontractorColumns}
      writePermission="subcontractor:write"
      searchPlaceholder="Ad veya kod ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <SubcontractorFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) =>
            onSubmit(buildSubcontractorPayload(values, initial) as unknown as Partial<Subcontractor>)
          }
        />
      )}
    />
  );
}

import { useQuery } from "@tanstack/react-query";
import { CrudPage } from "@/components/layout/CrudPage";
import { nextSortOrder } from "@/lib/sort-order";
import { fabricPropertyColumns } from "./columns";
import { fabricPropertyService } from "./service";
import { FabricPropertyFormDialog } from "./FabricPropertyFormDialog";
import type { FabricProperty } from "./types";
import type { FabricPropertyFormValues } from "./schema";

export function FabricPropertiesPage() {
  const allQ = useQuery({
    queryKey: ["fabric-properties", "all-for-sort"],
    queryFn: () =>
      fabricPropertyService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: "sortOrder",
        sortOrder: "desc",
        filters: {},
      }),
    staleTime: 60_000,
  });
  const nextOrder = nextSortOrder(allQ.data?.data ?? []);

  const buildPayload = (
    v: FabricPropertyFormValues,
    initial: FabricProperty | null,
  ): Partial<FabricProperty> => ({
    // Kod backend'de üretilir (OZL+GGAAYY+NNNN); create'te gönderilmez, edit'te korunur.
    ...(initial ? { code: initial.code } : {}),
    name: v.name,
    category: v.category?.trim() || null,
    description: v.description?.trim() || null,
    color: v.color?.trim() || null,
    sortOrder: initial?.sortOrder ?? nextOrder,
    isActive: v.isActive,
  });

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

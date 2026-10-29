import { useQuery } from "@tanstack/react-query";
import { CrudPage } from "@/components/layout/CrudPage";
import { nextSortOrder } from "@/lib/sort-order";
import { fabricPropertyColumns } from "./columns";
import { fabricPropertyService } from "./service";
import { FabricPropertyFormDialog } from "./FabricPropertyFormDialog";
import type { FabricProperty } from "./types";
import { loadAllForPicker } from "@/lib/picker-loader";
import { buildFabricPropertyPayload } from "./payload";

export function FabricPropertiesPage() {
  const allQ = useQuery({
    queryKey: ["fabric-properties", "all-for-sort"],
    queryFn: () =>
      loadAllForPicker(fabricPropertyService, {
        sortBy: "sortOrder",
        sortOrder: "desc",
        filters: {},
      }),
    staleTime: 60_000,
  });
  const nextOrder = nextSortOrder(allQ.data?.data ?? []);

  return (
    <CrudPage<FabricProperty>
      title="Kumaş Özellikleri"
      description="Yanmazlık, su geçirmezlik gibi kumaş kazanımları."
      entityName="Özellik"
      importEntity="fabricProperty"
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
          allProperties={allQ.data?.data ?? []}
          onSubmit={(values) => onSubmit(buildFabricPropertyPayload(values, initial, nextOrder))}
        />
      )}
    />
  );
}

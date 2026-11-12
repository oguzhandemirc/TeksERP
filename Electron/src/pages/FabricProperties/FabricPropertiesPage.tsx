import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CrudPage } from "@/components/layout/CrudPage";
import { nextSortOrder } from "@/lib/sort-order";
import { buildFabricPropertyColumns } from "./columns";
import { HIERARCHY_SORT, hierarchyRowClass, hierarchyRowSelectable } from "./hierarchy";
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
  // Ağaç (K21): ebeveyn satırı daraltılabilir, varsayılan açık; durum yalnız görüntü.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const columns = useMemo(() => buildFabricPropertyColumns({ collapsed, onToggle: toggle }), [collapsed, toggle]);
  const rowClassName = useCallback((row: FabricProperty) => hierarchyRowClass(row, collapsed), [collapsed]);
  const rowSelectable = useCallback((row: FabricProperty) => hierarchyRowSelectable(row, collapsed), [collapsed]);

  return (
    <CrudPage<FabricProperty>
      title="Kumaş Özellikleri"
      description="Yanmazlık, su geçirmezlik gibi kumaş kazanımları."
      entityName="Özellik"
      importEntity="fabricProperty"
      queryKey="fabric-properties"
      service={fabricPropertyService}
      columns={columns}
      defaultSortBy={HIERARCHY_SORT}
      rowClassName={rowClassName}
      rowSelectable={rowSelectable}
      writePermission="property:write"
      searchHint="Ad veya kategori"
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting, openEdit }) => (
        <FabricPropertyFormDialog
          // Ebeveyn → çeşit geçişinde form yeni kayıtla yeniden kurulur (reset yalnız açılışta koşar).
          key={initial?.id ?? "yeni"}
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          allProperties={allQ.data?.data ?? []}
          onOpenProperty={openEdit}
          onSubmit={(values) => onSubmit(buildFabricPropertyPayload(values, initial, nextOrder))}
        />
      )}
    />
  );
}

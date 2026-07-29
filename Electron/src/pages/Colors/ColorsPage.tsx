import { useQuery } from "@tanstack/react-query";
import { CrudPage } from "@/components/layout/CrudPage";
import { nextSortOrder } from "@/lib/sort-order";
import { colorColumns } from "./columns";
import { colorService } from "./service";
import { ColorFormDialog } from "./ColorFormDialog";
import { BulkColorAddDialog } from "./BulkColorAddDialog";
import type { Color } from "./types";
import type { ColorFormValues } from "./schema";

export function ColorsPage() {
  const allQ = useQuery({
    queryKey: ["colors", "all-for-sort"],
    queryFn: () =>
      colorService.getAll({
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
    v: ColorFormValues,
    initial: Color | null,
  ): Partial<Color> => ({
    // Kod backend'de üretilir (RNK+GGAAYY+NNNN); create'te gönderilmez, edit'te korunur.
    ...(initial?.code ? { code: initial.code } : {}),
    name: v.name,
    hex: v.hex || null,
    sortOrder: initial?.sortOrder ?? nextOrder,
    isActive: v.isActive,
    customerIds: v.customerIds,
  });

  return (
    <CrudPage<Color>
      title="Renkler"
      description="Boyahane renk kataloğu."
      entityName="Renk"
      queryKey="colors"
      service={colorService}
      columns={colorColumns}
      writePermission="property:write" // Y7 fix: backend color.routes property:* ister (item:* DEĞİL)
      searchPlaceholder="Kod veya ad ara..."
      filterBar={<BulkColorAddDialog />}
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <ColorFormDialog
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

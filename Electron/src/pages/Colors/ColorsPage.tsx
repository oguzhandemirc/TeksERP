import { useQuery } from "@tanstack/react-query";
import { CrudPage } from "@/components/layout/CrudPage";
import { generateCode, CODE_PREFIXES } from "@/lib/code-generator";
import { nextSortOrder } from "@/lib/sort-order";
import { colorColumns } from "./columns";
import { colorService } from "./service";
import { ColorFormDialog } from "./ColorFormDialog";
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
    code: initial?.code ?? generateCode(CODE_PREFIXES.COLOR),
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
      writePermission="item:write"
      searchPlaceholder="Kod veya ad ara..."
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

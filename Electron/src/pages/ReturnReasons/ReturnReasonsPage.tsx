import { useQuery } from "@tanstack/react-query";
import { CrudPage } from "@/components/layout/CrudPage";
import { generateCode, CODE_PREFIXES } from "@/lib/code-generator";
import { nextSortOrder } from "@/lib/sort-order";
import { returnReasonColumns } from "./columns";
import { returnReasonService } from "./service";
import { ReturnReasonFormDialog } from "./ReturnReasonFormDialog";
import type { ReturnReason } from "./types";
import type { ReturnReasonFormValues } from "./schema";

export function ReturnReasonsPage() {
  const allQ = useQuery({
    queryKey: ["return-reasons", "all-for-sort"],
    queryFn: () =>
      returnReasonService.getAll({
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
    v: ReturnReasonFormValues,
    initial: ReturnReason | null,
  ): Partial<ReturnReason> => ({
    code: initial?.code ?? generateCode(CODE_PREFIXES.RETURN_REASON),
    name: v.name,
    description: v.description || null,
    color: v.color || null,
    sortOrder: initial?.sortOrder ?? nextOrder,
    isActive: v.isActive,
  });

  return (
    <CrudPage<ReturnReason>
      title="İade Nedenleri"
      description="Müşteri iadesi neden kataloğu. İade ekranında seçenek olarak çıkar."
      entityName="İade Nedeni"
      queryKey="return-reasons"
      service={returnReasonService}
      columns={returnReasonColumns}
      writePermission="return:write"
      searchPlaceholder="Kod veya ad ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <ReturnReasonFormDialog
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

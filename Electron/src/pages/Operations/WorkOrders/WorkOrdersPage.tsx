import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import { useDataTable } from "@/hooks/useDataTable";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { workOrderColumns } from "./columns";
import { workOrderService } from "./service";
import { WorkOrderDetailSheet } from "./WorkOrderDetailSheet";
import { WorkOrderFormDialog } from "./WorkOrderFormDialog";
import type { FasonStepPlan } from "./FasonPlanningDialog";
import type { CustomRouteStep } from "./RouteDesignerDialog";
import type { WorkOrder } from "./types";
import type { WorkOrderFormValues } from "./schema";

const FILTERS: FilterDef[] = [
  {
    kind: "select",
    key: "status",
    label: "Durum",
    options: [
      { value: "PLANNED", label: "Planlandı" },
      { value: "IN_PROGRESS", label: "Devam Ediyor" },
      { value: "PAUSED", label: "Duraklatıldı" },
      { value: "COMPLETED", label: "Tamamlandı" },
      { value: "CANCELLED", label: "İptal" },
    ],
  },
  {
    kind: "select",
    key: "type",
    label: "Tip",
    options: [
      { value: "ORDER_PRODUCTION", label: "Siparişe Özel" },
      { value: "STOCK_PRODUCTION", label: "Stoka" },
    ],
  },
  {
    kind: "dateRange",
    label: "Tarih",
    defaultField: "createdAt",
    fieldOptions: [
      { value: "createdAt", label: "Açılış" },
      { value: "plannedStartDate", label: "Planlı Başlangıç" },
      { value: "plannedEndDate", label: "Planlı Bitiş" },
    ],
  },
];

const QUERY_KEY = "work-orders";

function trimOrNull(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  return t === "" ? null : t;
}

function dateOrNull(s: string | null | undefined): string | null {
  if (!s) return null;
  return new Date(s).toISOString();
}

interface StepPlanPayload {
  sequence: number;
  requiredCategoryId: string | null;
  plannedSubcontractorId: string | null;
  notes: string | null;
}

interface CreatePayload {
  type: string;
  routeTemplateId?: string;
  steps?: CustomRouteStep[];
  targetItemId: string | null;
  targetColorId: string | null;
  targetPropertyIds: string[];
  orderLineIds?: string[];
  stepPlanning?: StepPlanPayload[];
  width: number | null;
  targetQuantity: number | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  foldType: string | null;
}

function buildPayload(
  v: WorkOrderFormValues,
  meta: { fasonPlans: FasonStepPlan[]; customSteps: CustomRouteStep[] },
): CreatePayload {
  const orderLineIds = v.orderLineIds ?? [];
  const usingCustom = meta.customSteps.length > 0;

  // Custom rota: steps[] gönder; routeTemplateId yok, stepPlanning'e gerek yok.
  // Şablon rota: routeTemplateId + (varsa) stepPlanning overlay.
  const routePart: Pick<CreatePayload, "routeTemplateId" | "steps" | "stepPlanning"> = usingCustom
    ? { steps: meta.customSteps }
    : (() => {
        const stepPlanning: StepPlanPayload[] = meta.fasonPlans
          .filter(
            (p) => p.requiredCategoryId || p.plannedSubcontractorId || p.notes.trim(),
          )
          .map((p) => ({
            sequence: p.sequence,
            requiredCategoryId: p.requiredCategoryId,
            plannedSubcontractorId: p.plannedSubcontractorId,
            notes: p.notes.trim() === "" ? null : p.notes.trim(),
          }));
        return {
          routeTemplateId: v.routeTemplateId,
          ...(stepPlanning.length > 0 ? { stepPlanning } : {}),
        };
      })();

  return {
    type: v.type,
    ...routePart,
    targetItemId: v.targetItemId ?? null,
    targetColorId: v.targetColorId ?? null,
    targetPropertyIds: v.targetPropertyIds ?? [],
    ...(v.type === "ORDER_PRODUCTION" && orderLineIds.length > 0
      ? { orderLineIds }
      : {}),
    width: v.width ?? null,
    targetQuantity: v.targetQuantity ?? null,
    plannedStartDate: dateOrNull(v.plannedStartDate),
    plannedEndDate: dateOrNull(v.plannedEndDate),
    foldType: trimOrNull(v.foldType),
  };
}

export function WorkOrdersPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<WorkOrder | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WorkOrder | null>(null);

  const { table, query, search, setSearch, pagination } = useDataTable<WorkOrder>({
    queryKey: QUERY_KEY,
    fetchFn: workOrderService.listCursor,
    columns: workOrderColumns,
    defaultPageSize: 50,
  });

  const createMut = useMutation({
    mutationFn: (payload: CreatePayload) =>
      workOrderService.create(payload as unknown as Partial<WorkOrder>),
    onSuccess: () => {
      toast.success("İş emri oluşturuldu.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      setFormOpen(false);
    },
  });

  const replaceMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CreatePayload }) =>
      workOrderService.replace(id, payload as unknown as Partial<WorkOrder>),
    onSuccess: (_, vars) => {
      toast.success("İş emri güncellendi.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      void qc.invalidateQueries({ queryKey: ["work-order-detail", vars.id] });
      setFormOpen(false);
      setEditing(null);
    },
  });

  const handleEdit = (wo: WorkOrder) => {
    setSelected(null);
    setEditing(wo);
    setFormOpen(true);
  };

  const handleFormOpenChange = (open: boolean) => {
    setFormOpen(open);
    if (!open) setEditing(null);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="İş Emirleri"
        description="Üretim partileri ve rota ilerleyişi."
        actions={
          <>
            <RefreshButton queryKey={QUERY_KEY} />
            <PermissionGate permission="workorder:write">
              <Button size="sm" onClick={() => setFormOpen(true)}>
                <Plus className="h-4 w-4" /> Yeni İş Emri
              </Button>
            </PermissionGate>
          </>
        }
      />
      <DataTableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Parti numarası ara..."
      />
      <FilterBar filters={FILTERS} defaultDateRangeDays={30} />
      <DataTable<WorkOrder>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="İş emri bulunamadı."
        onRowClick={setSelected}
      />
      <WorkOrderDetailSheet
        workOrder={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
        onEdit={handleEdit}
      />
      <WorkOrderFormDialog
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        workOrder={editing}
        onSubmit={async (v, meta) => {
          const payload = buildPayload(v, meta);
          if (editing) {
            await replaceMut.mutateAsync({ id: editing.id, payload });
          } else {
            await createMut.mutateAsync(payload);
          }
        }}
        isSubmitting={editing ? replaceMut.isPending : createMut.isPending}
      />
    </div>
  );
}

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { fireConfetti } from "@/lib/confetti";
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
import { useTargetQuantityEnabled } from "@/hooks/usePricingEnabled";
import { WorkOrderType } from "@/types/enums";
import { pickedLinesFromOrder, type WoSeedTarget } from "./workOrderPrefill";
import type { PickedOrderLine } from "./OrderPickerDialog";
import type { FasonStepPlan } from "./FasonPlanningDialog";
import type { CustomRouteStep } from "./RouteDesignerDialog";
import type { WorkOrder } from "./types";
import type { WorkOrderFormValues } from "./schema";
import type { Order } from "@/pages/Operations/Orders/types";

const FILTERS: FilterDef[] = [
  {
    kind: "multi-select",
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
  targetQuantityEnabled: boolean,
): CreatePayload {
  const orderLineIds = v.orderLineIds ?? [];
  const hasLines = orderLineIds.length > 0;
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
    // Tip artık formda seçilmez — bağlı kalem varsa siparişe özel, yoksa stoğa.
    type: hasLines ? WorkOrderType.ORDER_PRODUCTION : WorkOrderType.STOCK_PRODUCTION,
    ...routePart,
    targetItemId: v.targetItemId ?? null,
    targetColorId: v.targetColorId ?? null,
    targetPropertyIds: v.targetPropertyIds ?? [],
    ...(hasLines ? { orderLineIds } : {}),
    width: v.width ?? null,
    targetQuantity: targetQuantityEnabled ? (v.targetQuantity ?? null) : null,
    plannedStartDate: dateOrNull(v.plannedStartDate),
    plannedEndDate: dateOrNull(v.plannedEndDate),
    foldType: trimOrNull(v.foldType),
  };
}

export function WorkOrdersPage() {
  const qc = useQueryClient();
  const targetQuantityEnabled = useTargetQuantityEnabled();
  const [selected, setSelected] = useState<WorkOrder | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WorkOrder | null>(null);
  const [seedLines, setSeedLines] = useState<PickedOrderLine[] | null>(null);
  const [seedTarget, setSeedTarget] = useState<WoSeedTarget | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Orders / Ürün Dengesi ekranından router state ile gelir:
  // - seedPickedLines: belirli spec'in açık kalemleri (hazır picker satırı,
  //   openQty=kalan; link-only). Toplu seçim + Denge "siparişlere bağla" modu.
  // - seedTarget: sipariş bağı olmadan hedef spec + miktar (Denge "stoğa üret").
  // - seedOrder: tek siparişin "iş emri oluştur" kısayolu (kalan kalemler süzülür).
  useEffect(() => {
    const state = location.state as
      | {
          seedOrder?: Order;
          seedPickedLines?: PickedOrderLine[];
          seedTarget?: WoSeedTarget;
        }
      | null;
    const picked =
      state?.seedPickedLines ??
      (state?.seedOrder ? pickedLinesFromOrder(state.seedOrder) : []);
    if (picked.length > 0) {
      setSeedLines(picked);
      setSeedTarget(null);
      setEditing(null);
      setFormOpen(true);
      navigate(location.pathname, { replace: true });
    } else if (state?.seedTarget) {
      setSeedTarget(state.seedTarget);
      setSeedLines(null);
      setEditing(null);
      setFormOpen(true);
      navigate(location.pathname, { replace: true });
    }
  }, [location.state, location.pathname, navigate]);

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
      fireConfetti();
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
    setSeedLines(null);
    setSeedTarget(null);
    setEditing(wo);
    setFormOpen(true);
  };

  const handleFormOpenChange = (open: boolean) => {
    setFormOpen(open);
    if (!open) {
      setEditing(null);
      setSeedLines(null);
      setSeedTarget(null);
    }
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
              <Button
                size="sm"
                onClick={() => {
                  setSeedLines(null);
                  setSeedTarget(null);
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
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
        table={table}
        exportName="İş Emirleri"
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
        initialPickedLines={editing ? undefined : seedLines ?? undefined}
        initialTarget={editing ? undefined : seedTarget ?? undefined}
        onSubmit={async (v, meta) => {
          const payload = buildPayload(v, meta, targetQuantityEnabled);
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

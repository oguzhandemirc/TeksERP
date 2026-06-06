import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, PanelRight, Pencil, Plus, Printer } from "lucide-react";
import { fireConfetti } from "@/lib/confetti";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { RowOpenItems, CopyMenuItem } from "@/components/data-table/row-menu-items";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import { useDataTable } from "@/hooks/useDataTable";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { workOrderColumns } from "./columns";
import { workOrderService } from "./service";
import { WorkOrderDetailSheet } from "./WorkOrderDetailSheet";
import { WorkOrderFormDialog } from "./WorkOrderFormDialog";
import { TravelerCardPrintDialog } from "./TravelerCardPrintDialog";
import { WorkOrderCancelDialog } from "./WorkOrderCancelDialog";
import { useTargetQuantityEnabled } from "@/hooks/usePricingEnabled";
import { type WoSeedTarget } from "./workOrderPrefill";
import type { PickedOrderLine } from "./OrderPickerDialog";
import type { WorkOrder } from "./types";
import { buildPayload, type CreatePayload } from "./workOrderPayload";

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


export function WorkOrdersPage() {
  const qc = useQueryClient();
  const targetQuantityEnabled = useTargetQuantityEnabled();
  const [selected, setSelected] = useState<WorkOrder | null>(null);
  const [printWo, setPrintWo] = useState<WorkOrder | null>(null);
  const [cancelWo, setCancelWo] = useState<WorkOrder | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WorkOrder | null>(null);
  const [seedLines, setSeedLines] = useState<PickedOrderLine[] | null>(null);
  const [seedTarget, setSeedTarget] = useState<WoSeedTarget | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Orders / Ürün Dengesi ekranından router state ile gelir:
  // - seedPickedLines: belirli spec'in açık kalemleri (hazır picker satırı,
  //   openQty=kalan; link-only). Toplu seçim, "bu üründen iş emri" kısayolu +
  //   Denge "siparişlere bağla" modu — hepsi tek ürün/renk/en'e süzülmüş gelir.
  // - seedTarget: sipariş bağı olmadan hedef spec + miktar (Denge "stoğa üret").
  useEffect(() => {
    const state = location.state as
      | {
          seedPickedLines?: PickedOrderLine[];
          seedTarget?: WoSeedTarget;
        }
      | null;
    const picked = state?.seedPickedLines ?? [];
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
        placeholder="Parti kodu ara..."
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
        rowContextMenu={(wo) => (
          <>
            <ContextMenuItem onSelect={() => setSelected(wo)}>
              <PanelRight /> Detayı aç (panel)
            </ContextMenuItem>
            <RowOpenItems path={`/operations/work-orders/${wo.id}`} />
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => setPrintWo(wo)}>
              <Printer /> Refakat kartı yazdır
            </ContextMenuItem>
            <PermissionGate permission="workorder:write">
              <ContextMenuItem onSelect={() => handleEdit(wo)}>
                <Pencil /> Düzenle
              </ContextMenuItem>
              {wo.status !== "COMPLETED" && wo.status !== "CANCELLED" && (
                <ContextMenuItem
                  onSelect={() => setCancelWo(wo)}
                  className="text-destructive focus:text-destructive"
                >
                  <Ban /> İptal et
                </ContextMenuItem>
              )}
            </PermissionGate>
            <ContextMenuSeparator />
            <CopyMenuItem label="Parti kodu" value={wo.batchNumber} />
          </>
        )}
      />
      <WorkOrderDetailSheet
        workOrder={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
        onEdit={handleEdit}
      />
      <TravelerCardPrintDialog
        workOrder={printWo}
        open={Boolean(printWo)}
        onOpenChange={(open) => !open && setPrintWo(null)}
      />
      <WorkOrderCancelDialog
        open={Boolean(cancelWo)}
        onOpenChange={(open) => !open && setCancelWo(null)}
        workOrderId={cancelWo?.id ?? null}
        batchNumber={cancelWo?.batchNumber}
        onCancelled={() => setCancelWo(null)}
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

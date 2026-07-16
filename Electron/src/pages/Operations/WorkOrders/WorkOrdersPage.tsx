import { useState, type MouseEvent } from "react";
import { Ban, PanelRight, Pencil, Plus, Printer } from "lucide-react";
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
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { useTabsStore } from "@/store/tabs";
import { workOrderColumns } from "./columns";
import { workOrderService } from "./service";
import { WorkOrderDetailSheet } from "./WorkOrderDetailSheet";
import { TravelerCardPrintDialog } from "./TravelerCardPrintDialog";
import { WorkOrderCancelDialog } from "./WorkOrderCancelDialog";
import { useTargetQuantityEnabled } from "@/hooks/usePricingEnabled";
import type { WorkOrder } from "./types";

const FILTERS: FilterDef[] = [
  {
    kind: "multi-select",
    key: "status",
    label: "Durum",
    options: [
      { value: "PLANNED", label: "Planlandı" },
      { value: "IN_PROGRESS", label: "Devam Ediyor" },
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
      { value: "STOCK_PRODUCTION", label: "Stok" },
    ],
  },
  // Üretilen kumaş (targetItem) + renk (targetColor) — backend where'e doğrudan geçer.
  { kind: "lookup", key: "targetItemId", label: "Kumaş", service: itemService, queryKey: "items" },
  { kind: "lookup", key: "targetColorId", label: "Renk", service: colorService, queryKey: "colors" },
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
const NEW_PATH = "/operations/work-orders/new";


export function WorkOrdersPage() {
  const targetQuantityEnabled = useTargetQuantityEnabled();
  const [selected, setSelected] = useState<WorkOrder | null>(null);
  const [printWo, setPrintWo] = useState<WorkOrder | null>(null);
  const [cancelWo, setCancelWo] = useState<WorkOrder | null>(null);
  const openTarget = useOpenTarget();
  const navigateActive = useTabsStore((s) => s.navigateActive);

  const { table, query, search, setSearch, pagination } = useDataTable<WorkOrder>({
    queryKey: QUERY_KEY,
    fetchFn: workOrderService.listCursor,
    columns: workOrderColumns,
    defaultPageSize: 50,
    initialVisibility: {
      targetQuantity: targetQuantityEnabled,
    },
  });

  // Düzenleme artık tam sayfa (/work-orders/:id/edit) — modal değil. Detay
  // panelinden / context menüden çağrılır; paneli kapatıp forma götürür.
  const handleEdit = (wo: WorkOrder) => {
    setSelected(null);
    navigateActive(`/operations/work-orders/${wo.id}/edit`);
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
                onClick={(e: MouseEvent) => openTarget(NEW_PATH, e)}
                title="Sol tık: bu sekmede · Shift/Ctrl+tık: yeni sekmede"
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
              {wo.status !== "COMPLETED" && wo.status !== "CANCELLED" && wo.status !== "SUPERSEDED" && (
                <ContextMenuItem
                  onSelect={() => setCancelWo(wo)}
                  className="text-destructive focus:text-destructive"
                >
                  <Ban /> İptal et
                </ContextMenuItem>
              )}
            </PermissionGate>
            <ContextMenuSeparator />
            <CopyMenuItem label="İş Emri No" value={wo.workOrderNumber} />
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
        batchNumber={cancelWo?.workOrderNumber}
        onCancelled={() => setCancelWo(null)}
      />
    </div>
  );
}

import { useState, type MouseEvent } from "react";
import { Ban, FileStack, PanelRight, Pencil, Plus, Printer } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { RowOpenItems, CopyMenuItem } from "@/components/data-table/row-menu-items";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import { useDataTable } from "@/hooks/useDataTable";
import { useHideCancelled } from "@/hooks/useHideCancelled";
import { ToolbarToggle } from "@/components/data-table/ToolbarToggle";
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
import { WorkOrderBulkDocsDialog } from "./WorkOrderBulkDocsDialog";
import type { BulkWorkOrder } from "./bulkDocs";
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
    // TEKİL KALIR (bilinçli): `type` NOT NULL + iki değerli → ikisini seçmek
    // "filtre yok" demektir. Tek seçimdeki açık "Tümü (Tip)" seçeneği daha net.
    // (Kat filtresi aksine ÇOKLU: orada NULL kat da var, yani "2-KAT + 4-KAT"
    // gerçekten "katı belirlenmiş toplar" anlamına geliyor.)
    kind: "select",
    key: "type",
    label: "Tip",
    options: [
      { value: "ORDER_PRODUCTION", label: "Siparişe Özel" },
      { value: "STOCK_PRODUCTION", label: "Stok" },
    ],
  },
  // Üretilen kumaş (targetItem) + renk (targetColor) — backend where'e doğrudan
  // geçer; `findAll` filtreleri allowlist'siz `buildWhereClause`'a verdiği için
  // CSV zaten `in`'e çevriliyor (ek backend işi gerekmedi).
  { kind: "multi-lookup", key: "targetItemId", label: "Kumaş", service: itemService, queryKey: "items" },
  { kind: "multi-lookup", key: "targetColorId", label: "Renk", service: colorService, queryKey: "colors" },
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
  // Toplu belge: diyalog AÇILDIĞI ANDAKİ seçim dondurulur. Canlı `table`
  // seçimini okumak, kullanıcı arkada satır tıklarsa hazırlanan kümeyi
  // altından değiştirirdi.
  const [bulkDocsFor, setBulkDocsFor] = useState<BulkWorkOrder[] | null>(null);
  const openTarget = useOpenTarget();
  const navigateActive = useTabsStore((s) => s.navigateActive);

  const { showCancelled, setShowCancelled, forceFilters } = useHideCancelled();

  const { table, query, search, setSearch, pagination } = useDataTable<WorkOrder>({
    queryKey: QUERY_KEY,
    fetchFn: workOrderService.listCursor,
    columns: workOrderColumns,
    defaultPageSize: 50,
    forceFilters,
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
    <PageShell>
      <PageHeader
        title="İş Emirleri"
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
        placeholder="İş emri, parti, kumaş, müşteri veya sipariş no ara..."
        table={table}
        exportName="İş Emirleri"
        actions={
          <ToolbarToggle
            checked={showCancelled}
            onCheckedChange={setShowCancelled}
            label="İptalleri göster"
            title="İptal edilmiş iş emirleri varsayılan olarak gizlidir."
          />
        }
      />
      <FilterBar filters={FILTERS} defaultDateRangeDays={30} />
      <DataTable<WorkOrder>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="İş emri bulunamadı."
        onRowClick={setSelected}
        exportName="İş Emirleri"
        selectionHint="Toplu belge çıkarmak için satırları seçin (refakat kartı, fason çeki, makbuz…)."
        bulkActions={(rows) => (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={rows.length === 0}
            onClick={() =>
              setBulkDocsFor(rows.map((w) => ({ id: w.id, workOrderNumber: w.workOrderNumber })))
            }
          >
            <FileStack className="h-3.5 w-3.5" />
            Belgeleri Çıkar
          </Button>
        )}
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
      <WorkOrderBulkDocsDialog
        open={Boolean(bulkDocsFor)}
        onOpenChange={(open) => !open && setBulkDocsFor(null)}
        workOrders={bulkDocsFor ?? []}
        onDone={() => table.resetRowSelection()}
      />
      <WorkOrderCancelDialog
        open={Boolean(cancelWo)}
        onOpenChange={(open) => !open && setCancelWo(null)}
        workOrderId={cancelWo?.id ?? null}
        batchNumber={cancelWo?.workOrderNumber}
        onCancelled={() => setCancelWo(null)}
      />
    </PageShell>
  );
}

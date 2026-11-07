import { workOrderTypeLabels } from "@/types/enums";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Ban, FileStack, PanelRight, Pencil, Plus, Printer } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { RowOpenItems, CopyMenuItem } from "@/components/data-table/row-menu-items";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { SavedViewsMenu } from "@/components/data-table/SavedViewsMenu";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import { useDataTable } from "@/hooks/useDataTable";
import { useListToggles } from "@/hooks/useListToggles";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { customerService } from "@/pages/Customers/service";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { useTabsStore } from "@/store/tabs";
import { workOrderColumns } from "./columns";
import { workOrderService } from "./service";
import { WorkOrderDetailSheet } from "./WorkOrderDetailSheet";
import { WorkOrdersFilterRow, workOrderPersistConfig } from "./WorkOrdersFilterRow";
import { TravelerCardPrintDialog } from "./TravelerCardPrintDialog";
import { WorkOrderCancelDialog } from "./WorkOrderCancelDialog";
import { WorkOrderBulkDocsDialog } from "./WorkOrderBulkDocsDialog";
import type { BulkWorkOrder } from "./bulkDocs";
import { useTargetQuantityEnabled } from "@/hooks/usePricingEnabled";
import type { WorkOrder } from "./types";
import { TERIM } from "@/lib/terim";
import { buildPlaceFilters, isInvalidFilterValueError, stripPlaceFilters } from "./work-order-filters";

// "Durum" kutusu (Durum + Şu an nerede + Özel) `WorkOrdersFilterRow`da.
const FILTERS: FilterDef[] = [
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
      { value: "CUSTOMER_GOODS_SERVICE", label: workOrderTypeLabels.CUSTOMER_GOODS_SERVICE },
    ],
  },
  // Üretilen kumaş (targetItem) + renk (targetColor) — backend where'e doğrudan
  // geçer; `findAll` filtreleri allowlist'siz `buildWhereClause`'a verdiği için
  // CSV zaten `in`'e çevriliyor (ek backend işi gerekmedi).
  { kind: "multi-lookup", key: "targetItemId", label: "Kumaş", service: itemService, queryKey: "items" },
  { kind: "multi-lookup", key: "targetColorId", label: "Renk", service: colorService, queryKey: "colors" },
  // Müşteri: WO'da customerId yok — backend süzgeci sipariş BAĞI üzerinden (`findAll` customerId
  // özel okur; koparılmış bağ eşleşmez). Bağsız (stok) iş emri hiçbir müşteriye eşleşmez.
  { kind: "multi-lookup", key: "customerId", label: "Müşteri", service: customerService, queryKey: "customers" },
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
const PERSIST = workOrderPersistConfig(FILTERS);
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

  // İki bağımsız anahtar + KALICI (localStorage): operatör "tamamlananları
  // gizle" dediyse bir sonraki girişte de gizli gelsin (2026-08-17 isteği).
  const {
    showCancelled,
    setShowCancelled,
    showCompleted,
    setShowCompleted,
    forceFilters,
  } = useListToggles({ scope: "work-orders", withCompleted: true });

  const { table, query, search, setSearch, pagination, fetchAll, listScope } = useDataTable<WorkOrder>({
    queryKey: QUERY_KEY,
    fetchFn: workOrderService.listCursor,
    columns: workOrderColumns,
    defaultPageSize: 50,
    forceFilters,
    persistFilters: PERSIST,
    initialVisibility: {
      targetQuantity: targetQuantityEnabled,
    },
  });

  // "Şu an hangi fasonda" bileşen içinde kurulur: TERIM okuma anında çözülür (modül düzeyinde
  // donardı); seçenekler listenin o anki kapsamıyla istenir (faceted sayım).
  const filters = useMemo<FilterDef[]>(
    () => [
      ...FILTERS,
      ...buildPlaceFilters((scope) => workOrderService.whereOptions(scope).then((r) => r.data), listScope),
    ],
    [listScope],
  );

  // Seçilen firma sunucuda artık yoksa (eski bağlantı, silinmiş kayıt) seçim düşer.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (!isInvalidFilterValueError(query.error)) return;
    const next = stripPlaceFilters(searchParams);
    if (!next) return;
    setSearchParams(next, { replace: true });
    toast.warning("Seçilen fason firma artık geçerli değil; seçim temizlendi.");
  }, [query.error, searchParams, setSearchParams]);

  // Düzenleme artık tam sayfa (/work-orders/:id/edit) — modal değil. Detay
  // panelinden / context menüden çağrılır; paneli kapatıp forma götürür.
  const handleEdit = (wo: WorkOrder) => {
    setSelected(null);
    navigateActive(`/operations/work-orders/${wo.id}/edit`);
  };

  return (
    <PageShell>
      <PageHeader
        title={TERIM.terbiyeIsEmri.cogul}
        actions={
          <>
            <RefreshButton queryKey={QUERY_KEY} />
            <PermissionGate permission="workorder:write">
              <Button
                size="sm"
                onClick={(e: MouseEvent) => openTarget(NEW_PATH, e)}
                title="Sol tık: bu sekmede · Shift/Ctrl+tık: yeni sekmede"
              >
                <Plus className="h-4 w-4" /> Yeni {TERIM.terbiyeIsEmri.tekil}
              </Button>
            </PermissionGate>
          </>
        }
      />
      <WorkOrdersFilterRow
        filters={filters}
        search={search}
        onSearchChange={setSearch}
        placeholder={`${TERIM.terbiyeIsEmri.cumleBasi.yalin}, parti, kumaş, müşteri, sipariş veya fiş/evrak no ara...`}
        showCompleted={showCompleted}
        setShowCompleted={setShowCompleted}
        showCancelled={showCancelled}
        setShowCancelled={setShowCancelled}
        trailing={
          <>
            <SavedViewsMenu compact />
            <DataTableTools table={table} exportName={TERIM.terbiyeIsEmri.cogul} fetchAll={fetchAll} compact />
          </>
        }
      />
      <DataTable<WorkOrder>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText={`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı.`}
        onRowClick={setSelected}
        exportName={TERIM.terbiyeIsEmri.cogul}
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
            <CopyMenuItem label={`${TERIM.terbiyeIsEmri.tekil} No`} value={wo.workOrderNumber} />
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

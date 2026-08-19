import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, PanelRight, Pencil, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { CopyMenuItem } from "@/components/data-table/row-menu-items";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import { useDataTable } from "@/hooks/useDataTable";
import { useHideCancelled } from "@/hooks/useHideCancelled";
import { ToolbarToggle } from "@/components/data-table/ToolbarToggle";
import { usePricingEnabled } from "@/hooks/usePricingEnabled";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { buildOrderColumns } from "./columns";
import { orderService } from "./service";
import { OrderDetailSheet } from "./OrderDetailSheet";
import { OrderFormDialog } from "./OrderFormDialog";
import { OrderCancelDialog } from "./OrderCancelDialog";
import { BulkCreateWorkOrderAction } from "./BulkCreateWorkOrderAction";
import { customerService } from "@/pages/Customers/service";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { branchLookupService } from "@/pages/Operations/Shipments/service";
import type { BranchLookupItem } from "@/pages/Operations/Shipments/types";
import { useTabsStore } from "@/store/tabs";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";
import type { Order } from "./types";
import { type OrderFormValues } from "./schema";

const FILTERS: FilterDef[] = [
  {
    kind: "multi-select",
    key: "status",
    label: "Durum",
    options: [
      { value: "PENDING", label: "Bekliyor" },
      { value: "APPROVED", label: "Onaylı" },
      { value: "PARTIAL_SHIPPED", label: "Kısmi Sevk" },
      { value: "COMPLETED", label: "Tamamlandı" },
      { value: "CANCELLED", label: "İptal" },
    ],
  },
  {
    // "İş Emri" rollup filtresi — backend'de hesaplanır (OrderService.extraWhere →
    // filter[woState]); rozet kolonuyla aynı semantik (work-order-rollup.ts).
    kind: "multi-select",
    key: "woState",
    label: "İş Emri",
    options: [
      { value: "NONE", label: "İş emri yok" },
      { value: "PLANNED", label: "Planlandı" },
      { value: "IN_PROGRESS", label: "Üretimde" },
      { value: "COMPLETED", label: "Üretildi" },
    ],
  },
  { kind: "multi-lookup", key: "customerId", label: "Müşteri", service: customerService, queryKey: "customers" },
  {
    // Şube SEÇİLEN MÜŞTERİ(LER)E bağlı (dependent-lookup): müşteri seçilmeden
    // pasif, seçilince yalnız o müşterilerin şubeleri. Müşteri ÇOKLU olabilir —
    // ham CSV `/api/customer-branches`e aynen geçer, BaseService onu `in` yapar.
    // Backend filter[branchId] (scalar) otomatik.
    kind: "dependent-lookup",
    key: "branchId",
    label: "Şube",
    dependsOn: "customerId",
    queryKey: "branch-lookup",
    placeholderNoParent: "Şube (önce müşteri)",
    fetchOptions: (customerId) =>
      branchLookupService
        .getAll({
          page: 1,
          pageSize: 200,
          sortBy: "name",
          sortOrder: "asc",
          filters: { isActive: "true", customerId },
        })
        .then((r) => r.data),
    getLabel: (it) => {
      const b = it as Partial<BranchLookupItem> & { id: string };
      if (!b.name) return b.id;
      return b.city ? `${b.name} (${b.city})` : b.name;
    },
  },
  // Kumaş/renk kalem-içi filtredir (`OrderService.extraWhere` → `lines.some`).
  // Çoklu seçimde de TEK `some` bloğu kalır: kumaş ∈ seçilenler VE renk ∈
  // seçilenler AYNI kalemde eşleşmeli ("kırmızı VEYA mavi patos kalemi").
  { kind: "multi-lookup", key: "itemId", label: "Kumaş", service: itemService, queryKey: "items" },
  { kind: "multi-lookup", key: "colorId", label: "Renk", service: colorService, queryKey: "colors" },
  {
    kind: "dateRange",
    label: "Tarih",
    defaultField: "createdAt",
    fieldOptions: [
      { value: "createdAt", label: "Sipariş Tarihi" },
      { value: "deadline", label: "Termin" },
    ],
  },
];

const QUERY_KEY = "orders";

interface CreatePayload {
  /** Boş = backend otomatik üretir (SIP + günlük sayaç). Doluysa o kullanılır. */
  orderNumber?: string;
  /** İdempotency anahtarı — timeout sonrası tekrar gönderimde mükerrer sipariş önlenir. */
  clientToken?: string;
  customerId: string;
  branchId: string | null;
  currency?: string;
  deadline: string | null;
  lines: {
    itemId: string;
    colorId: string | null;
    quantity: number;
    width: number | null;
    unitPrice?: string | null;
    customerItemName?: string | null;
    customerColorName?: string | null;
    cutNote?: string | null;
    requiredPropertyIds: string[];
  }[];
}

interface UpdateLinePayload {
  /** Mevcut OrderLine.id (update). Yeni satırda undefined (create). */
  id?: string;
  itemId: string;
  colorId: string | null;
  quantity: number;
  width: number | null;
  unitPrice?: string | null;
  customerItemName?: string | null;
  customerColorName?: string | null;
  cutNote?: string | null;
  requiredPropertyIds: string[];
}

interface UpdatePayload {
  customerId?: string;
  branchId?: string | null;
  currency?: string;
  deadline?: string | null;
  /** Kalem listesi (sipariş WO'ya bağlı değilse). Diff backend'de yapılır. */
  lines?: UpdateLinePayload[];
}

function buildCreatePayload(
  v: OrderFormValues,
  pricingEnabled: boolean,
  clientToken: string,
): CreatePayload {
  // Elle girildiyse o numara; boş bırakıldıysa alanı hiç göndermeyip backend'in
  // otomatik numaralandırmasını (SIP + günlük sayaç) devreye sokuyoruz.
  const manualOrderNumber = v.orderNumber?.trim();
  return {
    ...(manualOrderNumber ? { orderNumber: manualOrderNumber } : {}),
    clientToken,
    customerId: v.customerId,
    branchId: v.branchId || null,
    ...(pricingEnabled ? { currency: v.currency.trim().toUpperCase() } : {}),
    deadline: v.deadline ? new Date(v.deadline).toISOString() : null,
    lines: v.lines.map((l) => ({
      itemId: l.itemId,
      colorId: l.colorId ?? null,
      quantity: l.quantity,
      width: l.width ?? null,
      ...(pricingEnabled
        ? { unitPrice: l.unitPrice ? String(l.unitPrice) : null }
        : {}),
      customerItemName: l.customerItemName?.trim() ? l.customerItemName.trim() : null,
      customerColorName: l.customerColorName?.trim() ? l.customerColorName.trim() : null,
      cutNote: l.cutNote?.trim() ? l.cutNote.trim() : null,
      requiredPropertyIds: l.requiredPropertyIds ?? [],
    })),
  };
}

function buildUpdatePayload(
  v: OrderFormValues,
  pricingEnabled: boolean,
  editing: Order,
): UpdatePayload {
  // Kalemler ne zaman gönderilir: sipariş PARTIAL_SHIPPED değil + hiçbir kalem
  // aktif (CANCELLED dışı) bir WO'ya bağlı değil. Dialog aynı kontrolü yapıp
  // editor'u açıyor; backend de aynı kontrolü tekrar enforce ediyor.
  const linesEditable =
    editing.status !== "PARTIAL_SHIPPED" &&
    editing.lines.every((l) =>
      (l.workOrderLinks ?? []).every((link) => link.workOrder.status === "CANCELLED"),
    );

  const existingIds = new Set(editing.lines.map((l) => l.id));

  return {
    customerId: v.customerId,
    branchId: v.branchId ?? null,
    ...(pricingEnabled ? { currency: v.currency.trim().toUpperCase() } : {}),
    deadline: v.deadline ? new Date(v.deadline).toISOString() : null,
    ...(linesEditable
      ? {
          lines: v.lines.map((l) => ({
            // Form'daki clientId existing line id'siyle eşleşiyorsa update,
            // değilse yeni satır (id verilmez).
            ...(existingIds.has(l.clientId) ? { id: l.clientId } : {}),
            itemId: l.itemId,
            colorId: l.colorId ?? null,
            quantity: l.quantity,
            width: l.width ?? null,
            ...(pricingEnabled
              ? { unitPrice: l.unitPrice ? String(l.unitPrice) : null }
              : {}),
            customerItemName: l.customerItemName?.trim() ? l.customerItemName.trim() : null,
            customerColorName: l.customerColorName?.trim() ? l.customerColorName.trim() : null,
            cutNote: l.cutNote?.trim() ? l.cutNote.trim() : null,
            requiredPropertyIds: l.requiredPropertyIds ?? [],
          })),
        }
      : {}),
  };
}

export function OrdersPage() {
  const qc = useQueryClient();
  const openTab = useTabsStore((s) => s.openTab);
  // Panel Radix portal'ı (document.body) — pasif sekme `invisible` olsa da portal
  // kaçar. Yalnız Siparişler sekmesi aktifken göster; `selected` korunur, kullanıcı
  // sekmeye dönünce panel yeniden açılır.
  const isTabActive = useIsTabActive();
  const [selected, setSelected] = useState<Order | null>(null);
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  // İdempotency anahtarı — create form-oturumu kimliği. Form create modunda her
  // açılışta ve başarılı create'te yenilenir; hata sonrası SABİT kalır → timeout
  // sonrası kullanıcının elle tekrar göndermesi aynı token'ı taşır (mükerrer önlenir).
  // Update yoluna GİRMEZ (PATCH doğal idempotent).
  const [createToken, setCreateToken] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (formOpen && !editing) setCreateToken(crypto.randomUUID());
  }, [formOpen, editing]);

  // Deep-link: `?focus=<orderId>` (İE detayından "bağlı sipariş" tıklaması, Dashboard
  // yaklaşan siparişler vb.) → siparişi çekip detay panelini otomatik aç. Param sonra
  // temizlenir ki refresh/re-render tekrar tetiklemesin; 404'te sessizce geç.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const focusId = searchParams.get("focus");
    if (!focusId) return;
    let cancelled = false;
    orderService
      .getById(focusId)
      .then((res) => {
        if (!cancelled && res.data) setSelected(res.data);
      })
      .catch(() => {
        /* 404 / silinmiş sipariş — sessiz, panel açılmaz */
      })
      .finally(() => {
        if (cancelled) return;
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("focus");
            return next;
          },
          { replace: true },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [searchParams, setSearchParams]);

  const pricingEnabled = usePricingEnabled();
  const columns = useMemo(() => buildOrderColumns(pricingEnabled), [pricingEnabled]);

  const { showCancelled, setShowCancelled, forceFilters } = useHideCancelled();

  const { table, query, search, setSearch, pagination, fetchAll } = useDataTable<Order>({
    queryKey: QUERY_KEY,
    fetchFn: orderService.listCursor,
    columns,
    defaultPageSize: 50,
    forceFilters,
  });

  const isEmpty = query.isSuccess && !search && pagination.total === 0;

  const createMut = useMutation({
    mutationFn: (payload: CreatePayload) =>
      orderService.create(payload as unknown as Partial<Order>),
    onSuccess: () => {
      toast.success("Sipariş oluşturuldu.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      setFormOpen(false);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdatePayload }) =>
      orderService.update(id, payload as unknown as Partial<Order>),
    onSuccess: () => {
      toast.success("Sipariş güncellendi.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      setFormOpen(false);
      setEditing(null);
      setSelected(null);
    },
  });

  const handleEdit = (order: Order) => {
    setEditing(order);
    setSelected(null);
    setFormOpen(true);
  };

  const handleFormClose = (open: boolean) => {
    setFormOpen(open);
    if (!open) setEditing(null);
  };

  return (
    <PageShell>
      <PageHeader
        title="Siparişler"
        actions={
          <>
            <RefreshButton queryKey={QUERY_KEY} />
            <PermissionGate permission="order:write">
              <Button
                size="sm"
                className={isEmpty ? "animate-pulse" : undefined}
                onClick={() => setFormOpen(true)}
              >
                <Plus className="h-4 w-4" />
                Yeni Sipariş
              </Button>
            </PermissionGate>
          </>
        }
      />

      <DataTableToolbar
        fetchAll={fetchAll}
        search={search}
        onSearchChange={setSearch}
        placeholder="Sipariş no, iş emri no, firma veya kumaş ara..."
        table={table}
        exportName="Siparişler"
        actions={
          <ToolbarToggle
            checked={showCancelled}
            onCheckedChange={setShowCancelled}
            label="İptalleri göster"
            title="İptal edilmiş siparişler varsayılan olarak gizlidir."
          />
        }
      />
      <FilterBar filters={FILTERS} defaultDateRangeDays={30} />

      <DataTable<Order>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="Sipariş bulunamadı."
        onRowClick={setSelected}
        rowContextMenu={(order) => (
          <>
            <ContextMenuItem onSelect={() => setSelected(order)}>
              <PanelRight /> Detayı aç (panel)
            </ContextMenuItem>
            <PermissionGate permission="order:write">
              <ContextMenuItem onSelect={() => handleEdit(order)}>
                <Pencil /> Düzenle
              </ContextMenuItem>
              {order.status !== "COMPLETED" && order.status !== "CANCELLED" && (
                <ContextMenuItem
                  onSelect={() => setCancelOrder(order)}
                  className="text-destructive focus:text-destructive"
                >
                  <Ban /> İptal et
                </ContextMenuItem>
              )}
            </PermissionGate>
            <ContextMenuSeparator />
            <CopyMenuItem label="Sipariş no" value={order.orderNumber} />
          </>
        )}
        selectionHint="İş emri açmak için bir veya daha fazla sipariş seçin."
        bulkActions={(rows) => (
          <BulkCreateWorkOrderAction
            orders={rows}
            onDone={() => table.resetRowSelection()}
          />
        )}
      />

      <OrderDetailSheet
        order={selected}
        open={Boolean(selected) && isTabActive}
        onOpenChange={(open) => !open && setSelected(null)}
        onEdit={handleEdit}
        onCreateWorkOrder={(lines) => {
          // Açılan iş emri sekmesine yönlendir. Panel kapatılmaz — state'i
          // Siparişler sekmesinde açık kalır; başka kumaş için kullanıcı bu
          // sekmeye geri dönüp ilgili kalemin "İş emri"ne basabilir.
          openTab("/operations/work-orders/new", {
            forceNew: true,
            state: { seedPickedLines: lines },
          });
        }}
      />

      <OrderCancelDialog
        open={Boolean(cancelOrder)}
        onOpenChange={(open) => !open && setCancelOrder(null)}
        orderId={cancelOrder?.id ?? null}
        orderNumber={cancelOrder?.orderNumber}
        onCancelled={() => setCancelOrder(null)}
      />

      <OrderFormDialog
        open={formOpen}
        onOpenChange={handleFormClose}
        order={editing}
        onSubmit={async (v) => {
          if (editing) {
            await updateMut.mutateAsync({
              id: editing.id,
              payload: buildUpdatePayload(v, pricingEnabled, editing),
            });
          } else {
            await createMut.mutateAsync(buildCreatePayload(v, pricingEnabled, createToken));
          }
        }}
        isSubmitting={createMut.isPending || updateMut.isPending}
      />
    </PageShell>
  );
}

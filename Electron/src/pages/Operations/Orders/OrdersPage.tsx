import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Ban, Maximize2, PanelRight, Pencil, Plus, Wrench } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ListBand } from "@/components/layout/ListPage";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { CopyMenuItem } from "@/components/data-table/row-menu-items";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import { useDataTable } from "@/hooks/useDataTable";
import { RowMarkFilter, useRowMarkFilter } from "@/components/data-table/row-marks/RowMarkFilter";
import { SHOW_CANCELLED_PARAM, useHideCancelledInUrl } from "@/hooks/useHideCancelled";
import { usePricingEnabled, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { RecordSplit } from "@/components/record/RecordSidePanel";
import { OrdersFilterRow } from "./OrdersFilterRow";
import { ORDER_FILTERS, orderPersistConfig } from "./orders-filter-defs";
import { DataTableTools, type ExtraExportOption } from "@/components/data-table/DataTableTools";
import { SavedViewsMenu } from "@/components/data-table/SavedViewsMenu";
import { StockLineExportDialog } from "./stock-line-export/StockLineExportDialog";
import { buildOrderColumns } from "./columns";
import { resolveOrderFilters, canBulkCreateWorkOrder } from "./orders-regime";
import { orderService } from "./service";
import { OrderCancelDialog } from "./OrderCancelDialog";
import { BulkCreateWorkOrderAction } from "./BulkCreateWorkOrderAction";
import { useOpenTarget, useOpenTopLevel } from "@/components/layout/tabs/use-tab-target";
import type { Order } from "./types";
import { useDeepLinkParam } from "@/hooks/useDeepLinkParam";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { usePreferences } from "@/providers/PreferencesProvider";
import { OrdersStats, type OrderStatsView } from "./OrdersStats";
import { useOrderStats } from "./useOrderStats";
import { TERIM } from "@/lib/terim";
import { OrderPlanView, ORDER_PLAN_QUERY_KEY } from "./OrderPlanView";
import { OrdersViewTabs, readOrdersView } from "./OrdersViewTabs";
import { orderRecordPath } from "./record/order-record";
import { useOrderSelection } from "./record/useOrderSelection";
import { useOrderFormHost } from "./record/useOrderFormHost";
import { OrderSidePanel } from "./record/OrderSidePanel";

const QUERY_KEY = "orders";

export function OrdersPage() {
  const navigate = useNavigate();
  const openTarget = useOpenTopLevel();
  const openInPage = useOpenTarget();
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const [stockLineOpen, setStockLineOpen] = useState(false);
  const { hasPermission } = useRoleAccess();
  // Form (yeni + düzenle) ve mutasyonları tek sahipte — kayıt sayfası da aynısını kullanır.
  const form = useOrderFormHost();
  // Pano hızlı işlemi `?action=new` → yeni sipariş formu (buton gibi `order:write` ister; düğme de PermissionGate'li).
  useDeepLinkParam("action", (v) => { if (v === "new" && hasPermission("order:write")) form.openCreate(); });
  const [searchParams, setSearchParams] = useSearchParams();

  const pricingEnabled = usePricingEnabled();
  // TİCARET REJİMİ — üretim yüzeyleri (iş emri kolonu · filtresi · toplu
  // aksiyonu) süzülür. Fabrikada birebir bugünkü.
  const productionEnabled = useFeatureFlags().data?.data?.productionEnabled ?? true;
  const columns = useMemo(
    () => buildOrderColumns(pricingEnabled, productionEnabled),
    [pricingEnabled, productionEnabled],
  );
  const filters = useMemo(
    () => resolveOrderFilters(ORDER_FILTERS, productionEnabled),
    [productionEnabled],
  );

  const { showCancelled, setShowCancelled, forceFilters: cancelledFilters } = useHideCancelledInUrl();
  // "İşaretliler" süzgeci: kişinin işaretli kimlikleri `filter[id]` olarak liste + özet şeridine (sunucuda).
  const markFilter = useRowMarkFilter("order");
  const forceFilters = useMemo(() => ({ ...cancelledFilters, ...markFilter.filters }), [cancelledFilters, markFilter.filters]);
  const persistFilters = useMemo(() => orderPersistConfig(filters, productionEnabled), [filters, productionEnabled]);

  const { table, query, search, setSearch, pagination, fetchAll, listScope, filtersReady } = useDataTable<Order>({
    queryKey: QUERY_KEY,
    fetchFn: orderService.listCursor,
    columns,
    defaultPageSize: 50,
    forceFilters,
    persistFilters,
    enabled: markFilter.ready,
  });

  // ── Özet şeridi ── (kayıtlı süzgeç geri yüklenene dek beklenir: çift istek yok)
  const statsQuery = useOrderStats(forceFilters, filtersReady && markFilter.ready);
  const { prefs, setPreference, ready: prefsReady } = usePreferences();
  const statsView: OrderStatsView = prefs.orders?.statsView ?? "onerilen";
  const setStatsView = (v: OrderStatsView) =>
    // ⚠️ `prefsReady` gelmeden YAZMA: cache boşken setPreference
    // DEFAULT_PREFERENCES + patch yazar ve 600 ms sonra kullanıcının TÜM
    // tercihlerini (tema, favoriler, kolon düzeni) ezer.
    setPreference({ orders: { ...prefs.orders, statsView: v } });

  /**
   * Rozet tıklaması → URL filtresi. `null` değer anahtarı SİLER; sayfa
   * numarası/cursor sıfırlanır (yeni filtreyle eski sayfa anlamsız).
   */
  const applyStatsFilter = (patch: Record<string, string | null>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      next.delete("cursor");
      next.delete("page");
      return next;
    });
  };

  /**
   * Şeridin ÜSTÜNDEKİ kapsam etiketi. Sipariş ekranında 30 günlük varsayılan
   * pencere KALDIRILDI (2026-08-26) — yani şerit varsayılan olarak tüm
   * siparişleri sayar. Kullanıcı tarih seçtiğinde bunun görünmesi şart:
   * envanterdeki `scopeLabel` dersi ("hangi kümeyi sayıyorum?").
   */
  const statsScopeLabel =
    searchParams.get("dateFrom") || searchParams.get("dateTo")
      ? "SEÇİLİ TARİH ARALIĞI"
      : "TÜM SİPARİŞLER";

  // SY-K2: "Üretim planı" sekmesi URL'de (`?view=plan`) — kayıtlı görünüm sekmeyi de saklar.
  const view = readOrdersView(searchParams);

  const isEmpty = query.isSuccess && !search && pagination.total === 0;

  // "Dışa aktar ▾" menüsünde Excel'in altında (eski başlık düğmesinin yerine, #602).
  const stockLineExports: ExtraExportOption[] = [
    {
      key: "stock-line",
      label: "Excel (stok kalemi bazında)…",
      title: "Kumaş + renk başına tek satır: sipariş, sevk, açık, üretimde, depoda hazır",
      onSelect: () => setStockLineOpen(true),
    },
  ];

  // Satır seçimi URL'de (`?kayit=`); eski `?focus=` derin bağı çevrilir. ⌘/Ctrl+tık tam sayfayı yeni sekmede açar.
  const sel = useOrderSelection(table.getRowModel().rows.map((r) => r.original));
  const onRowClick = (order: Order, click?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; button: number }) => {
    if (click && (click.ctrlKey || click.metaKey || click.shiftKey || click.button === 1)) openInPage(orderRecordPath(order.id), click);
    else sel.select(sel.selectedId === order.id ? null : order.id);
  };

  return (
    <PageShell>
      <PageHeader
        title="Siparişler"
        actions={
          <>
            <RefreshButton queryKey={view === "plan" ? ORDER_PLAN_QUERY_KEY : QUERY_KEY} />
            {/* DEFTER ONARIMI — buradan kısa yol. Siparişin "Açık" görünmesinin
                sebebi çoğu zaman sevkiyatın deftere yazılamamış olmasıdır; o
                ekrana giden yolun sipariş listesinde durması bilinçli.
                Karo YALNIZ `shipping:repair-allocation` taşıyana çizilir. */}
            <PermissionGate permission="shipping:repair-allocation">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                title="Mal çıkmış ama sipariş defterine işlenmemiş sevkiyatlar"
                onClick={() => openTarget("/operations/allocation-repair")}
              >
                <Wrench className="h-4 w-4" />
                Yazılamayanlar
              </Button>
            </PermissionGate>
            <PermissionGate permission="order:write">
              <Button
                size="sm"
                className={isEmpty ? "animate-pulse" : undefined}
                onClick={form.openCreate}
              >
                <Plus className="h-4 w-4" />
                Yeni Sipariş
              </Button>
            </PermissionGate>
          </>
        }
      />

      <OrdersViewTabs view={view} />
      {view === "plan" ? (
        <OrderPlanView pricingEnabled={pricingEnabled} />
      ) : (
      <>
      <StockLineExportDialog
        open={stockLineOpen}
        onOpenChange={setStockLineOpen}
        fetchAll={fetchAll}
        listScope={listScope}
        productionEnabled={productionEnabled}
      />
      {/* ⚠️ SIRA SÖZLEŞMESİ (2026-09-04): özet şerit FİLTRELERİN ÜSTÜNDE.
          Kullanıcı gerekçesi: şerit "hangi kümeyi süzüyorum"un cevabı; filtre
          satırının altında kalınca listeye ait bir başlık gibi okunuyordu.
          Şerit tam genişlik (`w-full`, sola dayalı) — kendi içinde pencere
          genişliğine göre kademeleniyor (bkz. OrdersStats başlığı). */}
      <ListBand>
        <OrdersStats
          data={statsQuery.data?.data}
          isLoading={statsQuery.isLoading}
          scopeLabel={statsScopeLabel}
          view={statsView}
          onViewChange={setStatsView}
          viewLocked={!prefsReady}
          pricingEnabled={pricingEnabled}
          onApplyFilter={applyStatsFilter}
        />
      </ListBand>

      {/* 30 günlük varsayılan pencere KALDIRILDI (2026-08-26, kullanıcı kararı). Filtreler TEK SATIR
          (2026-11-06): arama + Görünüm ("Nerede?" sekmeleri) + Termin penceresi + kutular + "+ Filtre".
          ⚠️ Rejim-duyarlı `filters` verilir, ham `ORDER_FILTERS` DEĞİL (ticarette üretim süzgeci düşer). */}
      <RecordSplit
        list={
          <>
      <OrdersFilterRow
        filters={filters}
        productionEnabled={productionEnabled}
        search={search}
        onSearchChange={setSearch}
        placeholder={`Sipariş no, ${TERIM.terbiyeIsEmri.tekilKucuk} no, firma veya kumaş ara...`}
        showCancelled={showCancelled}
        setShowCancelled={setShowCancelled}
        forceFilters={cancelledFilters}
        cancelledUrlKey={SHOW_CANCELLED_PARAM}
        trailing={
          <>
            <RowMarkFilter value={markFilter.value} onChange={markFilter.setValue} truncated={markFilter.truncated} />
            <SavedViewsMenu compact />
            <DataTableTools
              table={table}
              exportName="Siparişler"
              fetchAll={fetchAll}
              extraExports={stockLineExports}
              compact
            />
          </>
        }
      />

      <DataTable<Order>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="Sipariş bulunamadı."
        markEntity="order"
        activeRowId={sel.selected ? sel.selectedId : null}
        onRowClick={onRowClick}
        rowContextMenu={(order) => (
          <>
            <ContextMenuItem onSelect={() => sel.select(order.id)}>
              <PanelRight /> Yan panelde aç
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => navigate(orderRecordPath(order.id))}>
              <Maximize2 /> Tam sayfa aç
            </ContextMenuItem>
            <PermissionGate permission="order:write">
              <ContextMenuItem onSelect={() => form.openEdit(order)}>
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
        selectionHint={
          canBulkCreateWorkOrder(productionEnabled)
            ? `${TERIM.terbiyeIsEmri.cumleBasi.yalin} açmak için bir veya daha fazla sipariş seçin.`
            : null
        }
        bulkActions={
          canBulkCreateWorkOrder(productionEnabled)
            ? (rows) => (
                <BulkCreateWorkOrderAction
                  orders={rows}
                  onDone={() => table.resetRowSelection()}
                />
              )
            : undefined
        }
      />
          </>
        }
        panel={
          sel.selected && (
            <OrderSidePanel
              key={sel.selected.id}
              order={sel.selected}
              onClose={() => sel.select(null)}
              onPrev={sel.prev}
              onNext={sel.next}
              onEdit={form.openEdit}
            />
          )
        }
      />

      </>
      )}

      <OrderCancelDialog
        open={Boolean(cancelOrder)}
        onOpenChange={(open) => !open && setCancelOrder(null)}
        orderId={cancelOrder?.id ?? null}
        orderNumber={cancelOrder?.orderNumber}
        onCancelled={() => setCancelOrder(null)}
      />

      {form.dialogs}
    </PageShell>
  );
}

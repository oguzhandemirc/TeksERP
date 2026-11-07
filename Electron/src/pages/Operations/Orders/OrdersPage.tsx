import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, PanelRight, Pencil, Plus, Wrench } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { CopyMenuItem } from "@/components/data-table/row-menu-items";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import { useDataTable } from "@/hooks/useDataTable";
import { SHOW_CANCELLED_PARAM, useHideCancelledInUrl } from "@/hooks/useHideCancelled";
import { usePricingEnabled, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { OrdersFilterRow } from "./OrdersFilterRow";
import { ORDER_FILTERS, orderPersistConfig } from "./orders-filter-defs";
import { DataTableTools, type ExtraExportOption } from "@/components/data-table/DataTableTools";
import { SavedViewsMenu } from "@/components/data-table/SavedViewsMenu";
import { StockLineExportDialog } from "./stock-line-export/StockLineExportDialog";
import { buildOrderColumns } from "./columns";
import { resolveOrderFilters, canBulkCreateWorkOrder } from "./orders-regime";
import { orderService } from "./service";
import { OrderDetailSheet } from "./OrderDetailSheet";
import { OrderFormDialog } from "./OrderFormDialog";
import { OrderCancelDialog } from "./OrderCancelDialog";
import { BulkCreateWorkOrderAction } from "./BulkCreateWorkOrderAction";
import { useTabsStore } from "@/store/tabs";
import { useOpenTopLevel } from "@/components/layout/tabs/use-tab-target";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";
import type { Order } from "./types";
import { buildCreatePayload, buildUpdatePayload, type CreatePayload, type UpdatePayload } from "./orderPayload";
import { useAttemptToken } from "@/lib/attemptToken";
import { usePreferences } from "@/providers/PreferencesProvider";
import { OrdersStats, type OrderStatsView } from "./OrdersStats";
import { useOrderStats } from "./useOrderStats";
import { TERIM } from "@/lib/terim";
import { OrderPlanView, ORDER_PLAN_QUERY_KEY } from "./OrderPlanView";
import { OrdersViewTabs, readOrdersView } from "./OrdersViewTabs";
import { opensProposalOnApprove, useProposalGates } from "./production-proposal/gates";
import { ProductionProposalDialog } from "./production-proposal/ProductionProposalDialog";

const QUERY_KEY = "orders";

export function OrdersPage() {
  const qc = useQueryClient();
  const openTab = useTabsStore((s) => s.openTab);
  const openTarget = useOpenTopLevel();
  // Panel Radix portal'ı (document.body) — pasif sekme `invisible` olsa da portal
  // kaçar. Yalnız Siparişler sekmesi aktifken göster; `selected` korunur, kullanıcı
  // sekmeye dönünce panel yeniden açılır.
  const isTabActive = useIsTabActive();
  const [selected, setSelected] = useState<Order | null>(null);
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [stockLineOpen, setStockLineOpen] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  // İdempotency anahtarı — create mantıksal deneme kimliği (kk1.md). Form create modunda
  // her açılışta, başarılı create'te ve kesin 4xx'te yenilenir; belirsiz hatada SABİT kalır
  // → timeout sonrası elle tekrar gönderim aynı token'ı taşır (mükerrer önlenir).
  // Update yoluna GİRMEZ (PATCH doğal idempotent).
  const createAttempt = useAttemptToken();
  useEffect(() => {
    if (formOpen && !editing) createAttempt.renew();
  }, [formOpen, editing, createAttempt]);

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

  const { showCancelled, setShowCancelled, forceFilters } = useHideCancelledInUrl();
  const persistFilters = useMemo(() => orderPersistConfig(filters, productionEnabled), [filters, productionEnabled]);

  const { table, query, search, setSearch, pagination, fetchAll, listScope, filtersReady } = useDataTable<Order>({
    queryKey: QUERY_KEY,
    fetchFn: orderService.listCursor,
    columns,
    defaultPageSize: 50,
    forceFilters,
    persistFilters,
  });

  // ── Özet şeridi ── (kayıtlı süzgeç geri yüklenene dek beklenir: çift istek yok)
  const statsQuery = useOrderStats(forceFilters, filtersReady);
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

  const proposalGates = useProposalGates();
  const [proposalOrder, setProposalOrder] = useState<Order | null>(null);
  const createMut = useMutation({
    mutationFn: (payload: CreatePayload) =>
      orderService.create(payload as unknown as Partial<Order>),
    // Sunucu `warnings` (kg/adet satırda karşılama ölçülmüyor) apiClient interceptor'ında basılır.
    onError: (e) => createAttempt.onFailure(e),
    onSuccess: (r) => {
      createAttempt.onSuccess();
      toast.success("Sipariş oluşturuldu.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      setFormOpen(false);
      // SY-M3: ONAYDA_TASLAK — sipariş doğuşta onaylıdır; önizleme kendiliğinden açılır (sessiz yaratma yok).
      if (opensProposalOnApprove(proposalGates.mode, proposalGates.buttonVisible, r.data)) setProposalOrder(r.data);
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

  // "Dışa aktar ▾" menüsünde Excel'in altında (eski başlık düğmesinin yerine, #602).
  const stockLineExports: ExtraExportOption[] = [
    {
      key: "stock-line",
      label: "Excel (stok kalemi bazında)…",
      title: "Kumaş + renk başına tek satır: sipariş, sevk, açık, üretimde, depoda hazır",
      onSelect: () => setStockLineOpen(true),
    },
  ];

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
                onClick={() => setFormOpen(true)}
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
      <div className="shrink-0 px-3 pt-2">
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
      </div>

      {/* 30 günlük varsayılan pencere KALDIRILDI (2026-08-26, kullanıcı kararı). Filtreler TEK SATIR
          (2026-11-06): arama + Görünüm ("Nerede?" sekmeleri) + Termin penceresi + kutular + "+ Filtre".
          ⚠️ Rejim-duyarlı `filters` verilir, ham `ORDER_FILTERS` DEĞİL (ticarette üretim süzgeci düşer). */}
      <OrdersFilterRow
        filters={filters}
        productionEnabled={productionEnabled}
        search={search}
        onSearchChange={setSearch}
        placeholder={`Sipariş no, ${TERIM.terbiyeIsEmri.tekilKucuk} no, firma veya kumaş ara...`}
        showCancelled={showCancelled}
        setShowCancelled={setShowCancelled}
        forceFilters={forceFilters}
        cancelledUrlKey={SHOW_CANCELLED_PARAM}
        trailing={
          <>
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
      )}

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
            await createMut.mutateAsync(buildCreatePayload(v, pricingEnabled, createAttempt.token()));
          }
        }}
        isSubmitting={createMut.isPending || updateMut.isPending}
      />
      {proposalOrder && (
        <ProductionProposalDialog open onOpenChange={(o) => !o && setProposalOrder(null)} orderId={proposalOrder.id} orderNumber={proposalOrder.orderNumber} lines={proposalOrder.lines} />
      )}
    </PageShell>
  );
}

// =============================================================================
// DOKUMA İŞLERİ — planlama listesi (panel)
// =============================================================================
// Dokuma işi bir İŞ EMRİ değildir: kendi varlığı, kendi yaşam döngüsü. Bu ekran
// yalnız PLANLAR ve KAPATIR/İPTAL EDER; "başlat" düğmesi YOKTUR — `IN_PROGRESS`
// tezgahta koşum açıldığında (tablet) kendiliğinden gelir. Top burada doğmaz
// (KK1 `entrySource=WEAVING`), sipariş bağı açılmaz (karşılama sevk anında).
//
// ⚠️ REJİM: ekran DOKUMA modülüne aittir. Karo `isWeavingOrdersVisible`
// (`weaving-regime.ts`); asıl sed backend `requireDokumaEnabled` (üç router).
// Okuma `weavingorder:read` (route), yazma `weavingorder:write` (PermissionGate).
//
// ⚠️ "HATA" ile "KAYIT YOK" ayrı ekranlardır: istek düşerse (modül kapalı, izin
// yok, sunucu yok) boş liste "kayıt yok" diye basılmaz — `DataTable.isError`.
// ⚠️ SÜZME SUNUCUDA (`status` CSV · `itemId` CSV · `subcontractorId` · arama).
// =============================================================================
import { useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { RefreshButton } from "@/components/RefreshButton";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { useDataTable } from "@/hooks/useDataTable";
import { itemService } from "@/pages/Items/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { orderService } from "@/pages/Operations/Orders/service";
import type { Order } from "@/pages/Operations/Orders/types";
import { weavingOrderColumns } from "./columns";
import { weavingOrderService } from "./service";
import { WeavingOrderFormDialog } from "./WeavingOrderFormDialog";
import { WeavingOrderCancelDialog, WeavingOrderCloseDialog } from "./WeavingOrderActionDialogs";
import { WeavingOrderRowMenu } from "./WeavingOrderRowMenu";
import { FasonSheet } from "./fason/FasonSheet";
import { WEAVING_ORDERS_QUERY_KEY, useWeavingOrderMutations } from "./useWeavingOrderMutations";
import { WEAVING_STATUSES, WEAVING_STATUS_META, type WeavingOrder } from "./types";

const FILTERS: FilterDef[] = [
  {
    kind: "multi-select",
    key: "status",
    label: "Durum",
    options: WEAVING_STATUSES.map((s) => ({ value: s, label: WEAVING_STATUS_META[s].label })),
  },
  // Kumaş seçici yalnız KUMAŞ kalemlerini listeler (backend zaten YARN'ı reddeder).
  { kind: "multi-lookup", key: "itemId", label: "Kumaş", service: itemService, queryKey: "items-weaving-filter", extraFilters: { itemType: "FABRIC" } },
  { kind: "lookup", key: "subcontractorId", label: "Fasoncu", service: subcontractorService, queryKey: "subcontractors-weaving-filter" },
  // Z2: bağlı sipariş — `filter[orderId]` (Z1 ucu). Etiket sipariş no (Order'da `name` yok).
  { kind: "lookup", key: "orderId", label: "Sipariş", service: orderService, queryKey: "orders-weaving-filter", getLabel: (o) => (o as unknown as Order).orderNumber },
];

/** Diyalog anahtarı: `null` kapalı · `"new"` oluştur · kayıt = düzenle. */
type FormTarget = null | "new" | WeavingOrder;
const swallow = () => undefined;

export function WeavingOrdersPage() {
  const [formTarget, setFormTarget] = useState<FormTarget>(null);
  const [closing, setClosing] = useState<WeavingOrder | null>(null);
  const [cancelling, setCancelling] = useState<WeavingOrder | null>(null);
  const [fason, setFason] = useState<WeavingOrder | null>(null);
  const closeAll = () => {
    setFormTarget(null);
    setClosing(null);
    setCancelling(null);
  };
  const { save, close, cancel } = useWeavingOrderMutations(closeAll);
  const { table, query, search, setSearch, pagination, fetchAll } = useDataTable<WeavingOrder>({
    queryKey: WEAVING_ORDERS_QUERY_KEY,
    fetchFn: weavingOrderService.listCursor,
    columns: weavingOrderColumns,
    defaultPageSize: 50,
    enableSelection: false,
  });
  const openForEdit = (r: WeavingOrder) => WEAVING_STATUS_META[r.status].open && setFormTarget(r);

  return (
    <PageShell>
      <PageHeader
        title="Dokuma İşleri"
        description="Ne dokunacak, ne kadar, kim dokuyacak. Koşum ve top indirme tabletten; 'devam ediyor' tezgahta koşum var demektir."
        actions={
          <div className="flex items-center gap-2">
            <PermissionGate permission="weavingorder:write">
              <Button size="sm" onClick={() => setFormTarget("new")}>
                <Plus className="mr-1 h-4 w-4" />
                Yeni Dokuma İşi
              </Button>
            </PermissionGate>
            <RefreshButton queryKey={WEAVING_ORDERS_QUERY_KEY} />
          </div>
        }
      />
      <DataTableToolbar fetchAll={fetchAll} search={search} onSearchChange={setSearch} placeholder="Dokuma no, kumaş veya fasoncu ara..." />
      <FilterBar filters={FILTERS} />
      <DataTable<WeavingOrder>
        table={table}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        errorText="Bu bir “kayıt yok” cevabı DEĞİLDİR — istek reddedildi ya da sunucuya ulaşamadı (modül kapalı, yetki yok, ağ)."
        pagination={pagination}
        emptyText="Dokuma işi yok. Planlamak için “Yeni Dokuma İşi”."
        onRowClick={openForEdit}
        rowContextMenu={(r) => <WeavingOrderRowMenu row={r} onEdit={setFormTarget} onClose={setClosing} onCancel={setCancelling} onFason={setFason} />}
      />
      {/* Diyaloglar KOŞULLU mount: her açılış taze bileşen ve taze `clientToken`. */}
      {formTarget !== null && (
        <WeavingOrderFormDialog
          open
          onOpenChange={(o) => !o && setFormTarget(null)}
          initial={formTarget === "new" ? null : formTarget}
          isSubmitting={save.isPending}
          onSubmit={(values, clientToken) =>
            save.mutateAsync({ id: formTarget === "new" ? null : formTarget.id, values, clientToken }).then(swallow, swallow)
          }
        />
      )}
      <WeavingOrderCloseDialog
        target={closing}
        onClose={() => setClosing(null)}
        isPending={close.isPending}
        onConfirm={(id) => close.mutateAsync(id).then(swallow, swallow)}
      />
      <FasonSheet order={fason} onClose={() => setFason(null)} />
      {cancelling && (
        <WeavingOrderCancelDialog
          target={cancelling}
          onClose={() => setCancelling(null)}
          isPending={cancel.isPending}
          onConfirm={(id, reason) => cancel.mutateAsync({ id, reason }).then(swallow, swallow)}
        />
      )}
    </PageShell>
  );
}

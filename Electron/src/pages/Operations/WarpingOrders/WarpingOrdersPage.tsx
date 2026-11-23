// =============================================================================
// FASON DEVERE SİPARİŞLERİ (devere D6a, plan E3) — liste · özet şeridi · yeni sipariş
// =============================================================================
// ⚠️ REJİM: devere modülü (karo `isWarpBeamsVisible`, route `devereEnabled`); asıl sed backend `requireDevereEnabled`.
// Okuma `warping-order:read`, yazma `warping-order:write`. Liste + özet TEK istek (sunucu tek where). Süzme sunucuda.
// Satır → kayıt SAYFASI (yan panel değil).
// =============================================================================
import { Plus } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { BandStats, ListBand } from "@/components/layout/ListPage";
import { isListFiltered } from "@/lib/list-scope";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { RefreshButton } from "@/components/RefreshButton";
import { DataTable } from "@/components/data-table/DataTable";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { DefFilterRow } from "@/components/data-table/filter-row/DefFilterRow";
import { persistConfigOf } from "@/components/data-table/filter-row/def-row-filters";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { useDataTable } from "@/hooks/useDataTable";
import { warpSpecService } from "@/pages/WarpSpecs/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { warpingOrderColumns } from "./columns";
import { fmtM } from "./order-model";
import { WARPING_ORDERS_QUERY_KEY, warpingOrderPath, warpingOrderService, type WarpingOrderPage } from "./service";
import { WarpingOrderFormDialog } from "./WarpingOrderFormDialog";
import { SEED_PARAM_KEYS, seedFromParams } from "./seed-params";
import { WARPING_ORDER_STATUSES, WARPING_STATUS_META, type WarpingOrderRow } from "./types";
import { FEE_FILTER_OPTIONS } from "@/pages/Finance/warpingFee";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";

export const FILTERS: FilterDef[] = [
  { kind: "multi-select", key: "status", label: "Durum", options: WARPING_ORDER_STATUSES.map((s) => ({ value: s, label: WARPING_STATUS_META[s].label })) },
  { kind: "lookup", key: "subcontractorId", label: "Devereci", service: subcontractorService, queryKey: "subcontractors-warping-filter" },
  { kind: "lookup", key: "warpSpecId", label: "Çözgü kartı", service: warpSpecService, queryKey: "warp-specs-warping-filter" },
  { kind: "dateRange", label: "Açılış", defaultField: "createdAt" },
];
/** Devere A2: fatura durumu süzgeci fatura bilgisidir — yalnız `finance:read` ∧ ön muhasebe açıkken çizilir. */
export const FEE_FILTER: FilterDef = { kind: "multi-select", key: "feeInvoiced", label: "Fatura", options: FEE_FILTER_OPTIONS };
const PERSIST = persistConfigOf(FILTERS);
const PRIMARY = ["status", "subcontractorId", "warpSpecId"];

export function WarpingOrdersPage() {
  const openTarget = useOpenTarget();
  const [sp, setSp] = useSearchParams();
  // Çözgü Hesabı / ihtiyaç önerisi "Sipariş aç" `?new=1&warpSpecId=…` ile gelir — form alanları dolu açılır.
  const seed = sp.get("new") === "1" ? seedFromParams(sp) : null;
  const closeNew = () => {
    const next = new URLSearchParams(sp);
    for (const k of SEED_PARAM_KEYS) next.delete(k);
    setSp(next, { replace: true });
  };
  const { table, query, search, setSearch, pagination, fetchAll, listScope } = useDataTable<WarpingOrderRow>({
    queryKey: WARPING_ORDERS_QUERY_KEY,
    fetchFn: warpingOrderService.listCursor,
    columns: warpingOrderColumns,
    defaultPageSize: 50,
    enableSelection: false,
    persistFilters: PERSIST,
  });
  const summary = (query.data?.pages[0] as WarpingOrderPage | undefined)?.summary ?? null;
  const canReadFinance = useRoleAccess().hasPermission("finance:read");
  const financeOn = useFeatureFlags().data?.data?.financeEnabled ?? false;
  const canFee = canReadFinance && financeOn;
  const filters = canFee ? [...FILTERS.slice(0, 3), FEE_FILTER, ...FILTERS.slice(3)] : FILTERS;

  return (
    <PageShell>
      <PageHeader
        title="Fason Devere Siparişleri"
        description="Devereciye verilen çözgü işleri: hangi karttan kaç levent, ne kadar iplik gidecek, hangisi sevkte. Satıra tıklayınca sipariş sayfası açılır."
        actions={
          <div className="flex items-center gap-2">
            <PermissionGate permission="warping-order:write">
              <Button size="sm" onClick={() => setSp(new URLSearchParams([...sp.entries(), ["new", "1"]]), { replace: true })}>
                <Plus className="mr-1 h-4 w-4" />
                Yeni Sipariş
              </Button>
            </PermissionGate>
            <RefreshButton queryKey={WARPING_ORDERS_QUERY_KEY} />
          </div>
        }
      />
      {summary && (
        <ListBand>
          <BandStats
            label="Sipariş özeti"
            scope={isListFiltered(listScope) ? "Filtreli" : undefined}
            items={[
              { key: "open", label: "Açık", value: summary.byStatus.OPEN },
              { key: "progress", label: "Sevkte", value: summary.byStatus.IN_PROGRESS, tone: summary.byStatus.IN_PROGRESS > 0 ? "warn" : undefined },
              { key: "done", label: "Kapandı", value: summary.byStatus.COMPLETED },
              { key: "len", label: "Bekleyen çözgü", value: fmtM(summary.openTargetLengthM), unit: "m", title: "Açık + sevkteki siparişlerin hedef metresi" },
            ]}
          />
        </ListBand>
      )}
      <DefFilterRow filters={filters} primaryKeys={canFee ? [...PRIMARY, "feeInvoiced"] : PRIMARY} search={search} onSearchChange={setSearch} searchHint="Sipariş no ile ara" tools={{ table, fetchAll, exportName: "Fason devere siparişleri" }} />
      <DataTable<WarpingOrderRow>
        table={table}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        errorText="Bu bir “kayıt yok” cevabı DEĞİLDİR — istek reddedildi ya da sunucuya ulaşamadı (modül kapalı, yetki yok, ağ)."
        pagination={pagination}
        emptyText="Fason devere siparişi yok. Açmak için “Yeni Sipariş”."
        onRowClick={(r, click) => openTarget(warpingOrderPath(r.id), click)}
      />
      {seed && <WarpingOrderFormDialog seed={seed} onClose={closeNew} onSaved={(id) => { closeNew(); openTarget(warpingOrderPath(id)); }} />}
    </PageShell>
  );
}

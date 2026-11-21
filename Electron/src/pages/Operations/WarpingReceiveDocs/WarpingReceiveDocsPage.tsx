// =============================================================================
// DEVERE DÖNÜŞ KABULLERİ (devere ek E2) — dönüş kabul belgeleri listesi · özet şeridi · yeni dönüş kabulü
// =============================================================================
// ⚠️ REJİM: devere modülü (karo `isWarpBeamsVisible`, route `devereEnabled`); asıl sed backend `requireDevereEnabled`.
// Okuma `warping-order:read`, kabul `warping-order:write`. Liste + özet TEK istek; arama (belge / irsaliye / sipariş
// no) ve süzme sunucuda. Satır → kayıt SAYFASI.
// =============================================================================
import { useState } from "react";
import { PackageCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { BandStats, ListBand } from "@/components/layout/ListPage";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { RefreshButton } from "@/components/RefreshButton";
import { DataTable } from "@/components/data-table/DataTable";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { DefFilterRow } from "@/components/data-table/filter-row/DefFilterRow";
import { persistConfigOf } from "@/components/data-table/filter-row/def-row-filters";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { useDataTable } from "@/hooks/useDataTable";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { ReceiveDocDialog } from "@/pages/Operations/WarpingOrders/ReceiveDocDialog";
import { WARPING_RECEIVE_DOCS_QUERY_KEY, warpingReceiveDocPath, warpingReceiveDocService, type WarpingReceiveDocPage } from "@/pages/Operations/WarpingOrders/receive-doc-service";
import type { WarpingReceiveDocRow } from "@/pages/Operations/WarpingOrders/receive-doc-types";
import { receiveDocColumns } from "./columns";

export const FILTERS: FilterDef[] = [
  { kind: "lookup", key: "subcontractorId", label: "Devereci", service: subcontractorService, queryKey: "subcontractors-receive-doc-filter" },
];
const PERSIST = persistConfigOf(FILTERS);

export function WarpingReceiveDocsPage() {
  const openTarget = useOpenTarget();
  const [creating, setCreating] = useState(false);
  const { table, query, search, setSearch, pagination, fetchAll } = useDataTable<WarpingReceiveDocRow>({
    queryKey: WARPING_RECEIVE_DOCS_QUERY_KEY,
    fetchFn: warpingReceiveDocService.listCursor,
    columns: receiveDocColumns,
    defaultPageSize: 50,
    enableSelection: false,
    persistFilters: PERSIST,
  });
  const summary = (query.data?.pages[0] as WarpingReceiveDocPage | undefined)?.summary ?? null;

  return (
    <PageShell>
      <PageHeader
        title="Devere Dönüş Kabulleri"
        description="Devereciden dönen leventlerin kabul belgeleri: bir irsaliye birden çok siparişin leventini taşıyabilir. Satıra tıklayınca belge açılır."
        actions={
          <div className="flex items-center gap-2">
            <PermissionGate permission="warping-order:write">
              <Button size="sm" onClick={() => setCreating(true)}>
                <PackageCheck className="mr-1 h-4 w-4" />
                Yeni Dönüş Kabulü
              </Button>
            </PermissionGate>
            <RefreshButton queryKey={WARPING_RECEIVE_DOCS_QUERY_KEY} />
          </div>
        }
      />
      {summary && (
        <ListBand>
          <BandStats
            label="Kabul özeti"
            scope="Süzgece uyan"
            items={[
              { key: "count", label: "Belge", value: summary.count },
              { key: "beams", label: "Levent", value: summary.beamCount },
            ]}
          />
        </ListBand>
      )}
      <DefFilterRow filters={FILTERS} primaryKeys={["subcontractorId"]} search={search} onSearchChange={setSearch} searchHint="Belge, irsaliye ya da sipariş no ile ara" tools={{ table, fetchAll, exportName: "Devere dönüş kabulleri" }} />
      <DataTable<WarpingReceiveDocRow>
        table={table}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        errorText="Bu bir “kayıt yok” cevabı DEĞİLDİR — istek reddedildi ya da sunucuya ulaşamadı (modül kapalı, yetki yok, ağ)."
        pagination={pagination}
        emptyText="Dönüş kabul belgesi yok. Devereci leventleri getirince “Yeni Dönüş Kabulü”."
        onRowClick={(r, click) => openTarget(warpingReceiveDocPath(r.id), click)}
      />
      {creating && <ReceiveDocDialog onClose={() => setCreating(false)} onCreated={(doc) => openTarget(warpingReceiveDocPath(doc.id))} />}
    </PageShell>
  );
}

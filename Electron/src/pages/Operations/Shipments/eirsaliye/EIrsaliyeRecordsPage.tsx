// e-İrsaliye kayıtları — tüm sevkiyatların e-İrsaliye kayıtları (iptal/red dahil). Liste
// cursor'lu, süzme ve özet sunucuda (tek where). Satır → sevkiyat detayı (kart orada).
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { DataTable } from "@/components/data-table/DataTable";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { SavedViewsMenu } from "@/components/data-table/SavedViewsMenu";
import { DefFilterRow } from "@/components/data-table/filter-row/DefFilterRow";
import { persistConfigOf } from "@/components/data-table/filter-row/def-row-filters";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { RefreshButton } from "@/components/RefreshButton";
import { useDataTable } from "@/hooks/useDataTable";
import { EIrsaliyeStatus, eIrsaliyeStatusLabels } from "@/types/enums";
import { EIrsaliyeUnconfigured } from "./EIrsaliyeSection";
import { EIrsaliyeSummaryStrip } from "./EIrsaliyeSummaryStrip";
import { eIrsaliyeRecordColumns } from "./recordsColumns";
import { eIrsaliyeService } from "./service";
import { EIRSALIYE_RECORDS_KEY, useEIrsaliyeReadiness } from "./useEIrsaliye";
import type { EIrsaliyeListItem } from "./types";

export const FILTERS: FilterDef[] = [
  {
    kind: "multi-select",
    key: "status",
    label: "Durum",
    options: Object.values(EIrsaliyeStatus).map((s) => ({ value: s, label: eIrsaliyeStatusLabels[s] })),
  },
  {
    kind: "select",
    key: "adapter",
    label: "Yöntem",
    options: [
      { value: "disaAktar", label: "Dışa aktar" },
      { value: "simulasyon", label: "Simülasyon" },
    ],
  },
];

export const PERSIST = persistConfigOf(FILTERS);
export const PRIMARY = ["status", "adapter"];

export function EIrsaliyeRecordsPage() {
  const navigate = useNavigate();
  const readiness = useEIrsaliyeReadiness(true);
  const { table, query, search, setSearch, pagination, fetchAll, filtersReady } = useDataTable<EIrsaliyeListItem>({
    queryKey: EIRSALIYE_RECORDS_KEY,
    fetchFn: eIrsaliyeService.listCursor,
    columns: eIrsaliyeRecordColumns,
    defaultPageSize: 50,
    enableSelection: false,
    persistFilters: PERSIST,
  });
  return (
    <PageShell>
      <PageHeader title="e-İrsaliye Kayıtları" actions={<RefreshButton queryKey={EIRSALIYE_RECORDS_KEY} />} />
      {readiness.data && readiness.data.durum !== "HAZIR" && <EIrsaliyeUnconfigured readiness={readiness.data} />}
      <EIrsaliyeSummaryStrip ready={filtersReady} />
      <DefFilterRow
        filters={FILTERS}
        primaryKeys={PRIMARY}
        search={search}
        onSearchChange={setSearch}
        placeholder="e-İrsaliye no, sevkiyat no, müşteri ya da tam ETTN ara…"
        trailing={
          <>
            <SavedViewsMenu compact />
            <DataTableTools table={table} exportName="e-İrsaliye Kayıtları" fetchAll={fetchAll} compact />
          </>
        }
      />
      <div className="min-w-0 overflow-x-auto">
        <DataTable<EIrsaliyeListItem>
          table={table}
          isLoading={query.isLoading}
          pagination={pagination}
          emptyText="e-İrsaliye kaydı yok."
          onRowClick={(r) => r.shipmentId && navigate(`/operations/shipments/${r.shipmentId}`)}
          exportName="e-İrsaliye Kayıtları"
        />
      </div>
    </PageShell>
  );
}

// e-İrsaliye kayıtları — tüm sevkiyatların e-İrsaliye kayıtları (iptal/red dahil). Liste
// cursor'lu, süzme ve özet sunucuda (tek where). Satır → sevkiyat detayı (kart orada).
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { RefreshButton } from "@/components/RefreshButton";
import { useDataTable } from "@/hooks/useDataTable";
import { EIrsaliyeStatus, eIrsaliyeStatusLabels } from "@/types/enums";
import { EIrsaliyeUnconfigured } from "./EIrsaliyeSection";
import { EIrsaliyeSummaryStrip } from "./EIrsaliyeSummaryStrip";
import { eIrsaliyeRecordColumns } from "./recordsColumns";
import { eIrsaliyeService } from "./service";
import { EIRSALIYE_RECORDS_KEY, useEIrsaliyeReadiness } from "./useEIrsaliye";
import type { EIrsaliyeListItem } from "./types";

const FILTERS: FilterDef[] = [
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

export function EIrsaliyeRecordsPage() {
  const navigate = useNavigate();
  const readiness = useEIrsaliyeReadiness(true);
  const { table, query, search, setSearch, pagination, fetchAll } = useDataTable<EIrsaliyeListItem>({
    queryKey: EIRSALIYE_RECORDS_KEY,
    fetchFn: eIrsaliyeService.listCursor,
    columns: eIrsaliyeRecordColumns,
    defaultPageSize: 50,
    enableSelection: false,
  });
  return (
    <PageShell>
      <PageHeader title="e-İrsaliye Kayıtları" actions={<RefreshButton queryKey={EIRSALIYE_RECORDS_KEY} />} />
      {readiness.data && readiness.data.durum !== "HAZIR" && <EIrsaliyeUnconfigured readiness={readiness.data} />}
      <DataTableToolbar
        fetchAll={fetchAll}
        search={search}
        onSearchChange={setSearch}
        placeholder="e-İrsaliye no, sevkiyat no, müşteri ya da tam ETTN ara…"
        table={table}
        exportName="e-İrsaliye Kayıtları"
      />
      <FilterBar filters={FILTERS} />
      <EIrsaliyeSummaryStrip />
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

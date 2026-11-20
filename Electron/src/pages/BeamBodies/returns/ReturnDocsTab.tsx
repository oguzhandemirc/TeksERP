// "İade belgeleri" sekmesi — liste (sunucuda süzülür: sahip, durum) · satır → belge görünümü (bas / iptal).
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { BandStats, ListBand } from "@/components/layout/ListPage";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table/DataTable";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { DefFilterRow } from "@/components/data-table/filter-row/DefFilterRow";
import { useDataTable } from "@/hooks/useDataTable";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { customerService } from "@/pages/Customers/service";
import { BEAM_BODY_RETURNS_QUERY_KEY, beamBodyReturnService } from "../service";
import type { BeamBodyReturnDoc } from "../types";
import { ReturnDocDialog } from "./ReturnDocDialog";

const FILTERS: FilterDef[] = [
  { kind: "lookup", key: "ownerCustomerId", label: "Sahip", service: customerService, queryKey: "customers-beam-body-return-filter" },
  { kind: "select", key: "status", label: "Durum", options: [{ value: "active", label: "Geçerli" }, { value: "cancelled", label: "İptal" }, { value: "all", label: "Hepsi" }] },
];

const columns: ColumnDef<BeamBodyReturnDoc>[] = [
  { accessorKey: "docNo", header: "Belge no", cell: ({ row }) => <span className="font-mono text-sm">{row.original.docNo}</span> },
  { id: "owner", header: "Sahip", meta: { exportValue: (r: BeamBodyReturnDoc) => r.owner.name }, cell: ({ row }) => row.original.owner.name },
  { id: "count", header: "Gövde", meta: { exportValue: (r: BeamBodyReturnDoc) => r.items.length }, cell: ({ row }) => <span className="tabular-nums">{row.original.items.length}</span> },
  { id: "bodies", header: "Gövde no'ları", meta: { exportValue: (r: BeamBodyReturnDoc) => r.items.map((i) => i.bodyNo).join(", ") }, cell: ({ row }) => <span className="font-mono text-xs">{row.original.items.slice(0, 5).map((i) => i.bodyNo).join(", ")}{row.original.items.length > 5 ? ` +${row.original.items.length - 5}` : ""}</span> },
  { id: "returnedAt", header: "Tarih", meta: { exportValue: (r: BeamBodyReturnDoc) => fmtFactoryDateTime(r.returnedAt) }, cell: ({ row }) => <span className="tabular-nums">{fmtFactoryDateTime(row.original.returnedAt)}</span> },
  {
    id: "status",
    header: "Durum",
    meta: { exportValue: (r: BeamBodyReturnDoc) => (r.status === "CANCELLED" ? "İptal" : "Geçerli") },
    cell: ({ row }) => (row.original.status === "CANCELLED" ? <Badge variant="outline" className="font-normal text-muted-foreground">İptal</Badge> : <Badge className="bg-emerald-100 font-normal text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Geçerli</Badge>),
  },
];

export function ReturnDocsTab() {
  const [openId, setOpenId] = useState<string | null>(null);
  const { table, query, search, setSearch, pagination, fetchAll } = useDataTable<BeamBodyReturnDoc>({
    queryKey: BEAM_BODY_RETURNS_QUERY_KEY,
    fetchFn: beamBodyReturnService.list,
    columns,
    defaultPageSize: 50,
    enableSelection: false,
  });
  const s = (query.data?.pages[0] as { summary?: { count: number; bodyCount: number } | null } | undefined)?.summary ?? null;
  return (
    <>
      {s && (
        <ListBand>
          <BandStats label="İade özeti" scope="Süzgece uyan" items={[{ key: "docs", label: "Belge", value: s.count }, { key: "bodies", label: "İade edilen gövde", value: s.bodyCount }]} />
        </ListBand>
      )}
      <DefFilterRow filters={FILTERS} primaryKeys={["ownerCustomerId", "status"]} search={search} onSearchChange={setSearch} searchHint="Belge no ile ara" tools={{ table, fetchAll, exportName: "Gövde iade belgeleri" }} />
      <DataTable<BeamBodyReturnDoc>
        table={table}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        errorText="Bu bir “kayıt yok” cevabı DEĞİLDİR — istek reddedildi ya da sunucuya ulaşamadı."
        pagination={pagination}
        emptyText="İade belgesi yok. “Sahibine iade” sekmesinden oluşturulur."
        onRowClick={(r) => setOpenId(r.id)}
      />
      {openId && <ReturnDocDialog docId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

// Gövdeler sekmesi — özet şeridi + süzgeç satırı + tablo. Liste + özet TEK istek (sunucu tek where); süzme sunucuda.
// Satır → kayıt sayfası; çoklu seçimde "QR etiketi bas" (gövde başına döngü, toplu uç yok).
import { useState } from "react";
import { Tag } from "lucide-react";
import { BandStats, ListBand } from "@/components/layout/ListPage";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { PermissionGate } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { DefFilterRow } from "@/components/data-table/filter-row/DefFilterRow";
import { persistConfigOf } from "@/components/data-table/filter-row/def-row-filters";
import { useDataTable } from "@/hooks/useDataTable";
import { machineService } from "@/pages/Machines/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { warehouseService } from "@/pages/Warehouses/service";
import { beamBodyColumns } from "./columns";
import { BeamBodyLabelDialog, isBeamBodyLabelPrintable } from "./BeamBodyLabelDialog";
import { BEAM_BODIES_QUERY_KEY, beamBodyPath, beamBodyService, type BeamBodyPage } from "./service";
import { BEAM_BODY_OWNER_KINDS, BEAM_BODY_OWNER_LABELS, BEAM_BODY_STATUSES, BEAM_BODY_STATUS_META, type BeamBody } from "./types";

export const FILTERS: FilterDef[] = [
  { kind: "multi-select", key: "owner", label: "Sahip", options: BEAM_BODY_OWNER_KINDS.map((k) => ({ value: k, label: BEAM_BODY_OWNER_LABELS[k] })) },
  { kind: "multi-select", key: "status", label: "Durum", options: BEAM_BODY_STATUSES.map((s) => ({ value: s, label: BEAM_BODY_STATUS_META[s].label })) },
  { kind: "lookup", key: "subcontractorId", label: "Devereci (yer)", service: subcontractorService, queryKey: "subcontractors-beam-body-filter" },
  { kind: "lookup", key: "warehouseId", label: "Depo", service: warehouseService, queryKey: "warehouses-beam-body-filter" },
  { kind: "lookup", key: "machineId", label: "Tezgâh (takılı)", service: machineService, queryKey: "machines-beam-body-filter" },
  { kind: "select", key: "ownerReturnDue", label: "Sahibine iade", options: [{ value: "true", label: "Yalnız iade edilecekler" }] },
  { kind: "select", key: "active", label: "Kart", options: [{ value: "active", label: "Aktif" }, { value: "inactive", label: "Pasif" }, { value: "all", label: "Hepsi" }] },
];
const PERSIST = persistConfigOf(FILTERS);
const PRIMARY = ["owner", "status", "subcontractorId"];

export function BeamBodiesList() {
  const openTarget = useOpenTarget();
  const [printing, setPrinting] = useState<BeamBody[] | null>(null);
  const { table, query, search, setSearch, pagination, fetchAll } = useDataTable<BeamBody>({
    queryKey: BEAM_BODIES_QUERY_KEY,
    fetchFn: beamBodyService.listCursor,
    columns: beamBodyColumns,
    defaultPageSize: 50,
    persistFilters: PERSIST,
  });
  const s = (query.data?.pages[0] as BeamBodyPage | undefined)?.summary ?? null;
  return (
    <>
      {s && (
        <ListBand>
          <BandStats
            label="Gövde özeti"
            scope="Süzgece uyan"
            items={[
              { key: "all", label: "Toplam", value: s.count },
              ...BEAM_BODY_OWNER_KINDS.map((k) => ({ key: k, label: BEAM_BODY_OWNER_LABELS[k], value: s.byOwner[k] ?? 0 })),
              { key: "due", label: "Sahibine iade edilecek", value: s.ownerReturnDue, tone: s.ownerReturnDue > 0 ? ("warn" as const) : undefined, title: "Bizim olmayan, boş ve bizde duran gövdeler" },
            ]}
          />
        </ListBand>
      )}
      <DefFilterRow filters={FILTERS} primaryKeys={PRIMARY} search={search} onSearchChange={setSearch} searchHint="Gövde no ile ara" tools={{ table, fetchAll, exportName: "Levent gövdeleri" }} />
      <DataTable<BeamBody>
        table={table}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        errorText="Bu bir “kayıt yok” cevabı DEĞİLDİR — istek reddedildi ya da sunucuya ulaşamadı (ayar kapalı, yetki yok, ağ)."
        pagination={pagination}
        emptyText="Levent gövdesi yok. Kaydetmek için “Yeni Gövde”."
        selectionHint="QR etiketi basmak için gövdeleri seçin."
        onRowClick={(r, click) => openTarget(beamBodyPath(r.id), click)}
        bulkActions={(rows) => {
          const printable = rows.filter(isBeamBodyLabelPrintable);
          return (
            <PermissionGate permission="label:print">
              <Button size="sm" variant="outline" disabled={printable.length === 0} onClick={() => setPrinting(printable)} title={printable.length < rows.length ? "Hurda, iade edilmiş ya da pasif gövdeler basılmaz" : undefined}>
                <Tag className="mr-1 h-4 w-4" /> QR etiketi bas ({printable.length})
              </Button>
            </PermissionGate>
          );
        }}
      />
      {printing && <BeamBodyLabelDialog bodies={printing} onClose={() => setPrinting(null)} />}
    </>
  );
}

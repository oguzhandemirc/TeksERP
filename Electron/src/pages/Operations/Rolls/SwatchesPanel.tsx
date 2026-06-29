import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { useDataTable } from "@/hooks/useDataTable";
import { itemService } from "@/pages/Items/service";
import { parseUrlToQueryParams } from "@/lib/query-builder";
import { useKartelaMeasurementEnabled } from "@/hooks/usePricingEnabled";
import { swatchService, type Swatch, type SwatchStats } from "./swatchService";
import { buildSwatchColumns } from "./swatchColumns";
import { SwatchDetailSheet } from "./SwatchDetailSheet";

const NUM_FMT = new Intl.NumberFormat("tr-TR");
const DEC_FMT = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

const FILTERS: FilterDef[] = [
  {
    kind: "lookup",
    key: "itemId",
    label: "Ürün",
    service: itemService,
    queryKey: "items",
  },
];

function SwatchesStats({
  data,
  isLoading,
  showMeasure,
}: {
  data: SwatchStats | undefined;
  isLoading: boolean;
  showMeasure: boolean;
}) {
  if (isLoading && !data) {
    return <span className="text-xs text-muted-foreground">Yükleniyor…</span>;
  }
  if (!data) return null;
  return (
    <div className="flex items-center gap-3 text-xs">
      <Stat label="Kartela" value={NUM_FMT.format(data.count)} unit="adet" />
      {showMeasure && (
        <>
          <Divider />
          <Stat label="Uzunluk" value={DEC_FMT.format(data.totalLength)} unit="cm" />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground tabular-nums">{value}</span>
      <span className="text-[10px] text-muted-foreground">{unit}</span>
    </div>
  );
}

function Divider() {
  return <span className="h-3 w-px bg-border" aria-hidden />;
}

export function SwatchesPanel() {
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<Swatch | null>(null);
  const showMeasure = useKartelaMeasurementEnabled();

  const columns = useMemo(() => buildSwatchColumns({ showMeasure }), [showMeasure]);
  const { table, query, search, setSearch, pagination } = useDataTable<Swatch>({
    queryKey: "swatches",
    fetchFn: swatchService.listCursor,
    columns,
    defaultPageSize: 100,
  });

  // Stats query — liste ile aynı filtre + search'i paylaşır.
  const urlParams = useMemo(
    () => parseUrlToQueryParams(searchParams.toString(), { pageSize: 100 }),
    [searchParams],
  );
  const statsQuery = useQuery({
    queryKey: ["swatches", "stats", urlParams.filters, urlParams.search],
    queryFn: () =>
      swatchService.getStats({
        filters: urlParams.filters,
        search: urlParams.search,
      }),
    staleTime: 0,
  });

  return (
    <>
      <DataTableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Barkod / kart no / ürün / parti ara..."
        actions={
          <SwatchesStats
            data={statsQuery.data?.data}
            isLoading={statsQuery.isLoading}
            showMeasure={showMeasure}
          />
        }
      />
      <FilterBar filters={FILTERS} />
      <DataTable<Swatch>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="Kartela bulunamadı."
        onRowClick={setSelected}
      />
      <SwatchDetailSheet
        swatch={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  );
}

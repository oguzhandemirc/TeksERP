import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { RefreshButton } from "@/components/RefreshButton";
import { useDataTable } from "@/hooks/useDataTable";
import { shipmentColumns } from "./columns";
import { shipmentService } from "./service";
import { shipmentStatusLabels, type ShipmentListItem } from "./types";
import { ShipmentDetailSheet } from "./ShipmentDetailSheet";

const QUERY_KEY = "shipments";

const TABS: { key: string; label: string }[] = [
  { key: "ALL", label: "Tümü" },
  { key: "PREPARING", label: shipmentStatusLabels.PREPARING },
  { key: "READY", label: shipmentStatusLabels.READY },
  { key: "DISPATCHED", label: shipmentStatusLabels.DISPATCHED },
  { key: "CANCELLED", label: shipmentStatusLabels.CANCELLED },
];

export function ShipmentsPage() {
  // Sevk edilenler birincil görünüm — varsayılan sekme.
  const [statusTab, setStatusTab] = useState<string>("DISPATCHED");
  const [selected, setSelected] = useState<ShipmentListItem | null>(null);

  // forceFilters → useDataTable backend'e filter[status] yollar (URL kirletmeden,
  // sekme değişince cursor sıfırlanıp refetch olur). "ALL" → filtre yok.
  const forceFilters = useMemo(
    () => (statusTab === "ALL" ? undefined : { status: statusTab }),
    [statusTab],
  );

  const { table, query, search, setSearch, pagination } = useDataTable<ShipmentListItem>({
    queryKey: QUERY_KEY,
    fetchFn: shipmentService.listCursor,
    columns: shipmentColumns,
    defaultPageSize: 50,
    forceFilters,
    enableSelection: false,
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Sevkiyatlar"
        description="Müşteri sevkiyatları — hazırlanan, hazır ve sevk edilenler."
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />
      <div className="flex flex-wrap gap-1 px-1 pb-2">
        {TABS.map((t) => (
          <Button
            key={t.key}
            size="sm"
            variant={statusTab === t.key ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setStatusTab(t.key)}
          >
            {t.label}
          </Button>
        ))}
      </div>
      <DataTableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Sevkiyat no ara..."
        table={table}
        exportName="Sevkiyatlar"
      />
      <DataTable<ShipmentListItem>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="Sevkiyat bulunamadı."
        onRowClick={setSelected}
      />
      <ShipmentDetailSheet
        shipmentId={selected?.id ?? null}
        open={Boolean(selected)}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </div>
  );
}

import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { RefreshButton } from "@/components/RefreshButton";
import { useDataTable } from "@/hooks/useDataTable";
import { customerService } from "@/pages/Customers/service";
import { shipmentColumns } from "./columns";
import { shipmentService, branchLookupService } from "./service";
import {
  shipmentStatusLabels,
  type ShipmentListItem,
  type BranchLookupItem,
} from "./types";
import { ShipmentDetailSheet } from "./ShipmentDetailSheet";

const QUERY_KEY = "shipments";

// Tüm filtreler FilterBar'da (durum dahil — sekme yok). Durum çoklu-seçim (Sipariş
// paritesi). Şube SEÇİLEN MÜŞTERİYE bağlı (dependent-lookup): müşteri seçilmeden
// pasif, seçilince yalnız o müşterinin şubeleri (global endpoint filter[customerId]
// ile daraltılır). Tarih varsayılanı createdAt (indexli); Sevk/Hazır opsiyonel.
const FILTERS: FilterDef[] = [
  {
    kind: "multi-select",
    key: "status",
    label: "Durum",
    options: [
      { value: "PREPARING", label: shipmentStatusLabels.PREPARING },
      { value: "READY", label: shipmentStatusLabels.READY },
      { value: "AT_DOOR", label: shipmentStatusLabels.AT_DOOR },
      { value: "DISPATCHED", label: shipmentStatusLabels.DISPATCHED },
      { value: "CANCELLED", label: shipmentStatusLabels.CANCELLED },
    ],
  },
  {
    kind: "lookup",
    key: "customerId",
    label: "Müşteri",
    service: customerService,
    queryKey: "customers",
  },
  {
    kind: "dependent-lookup",
    key: "branchId",
    label: "Şube",
    dependsOn: "customerId",
    queryKey: "branch-lookup",
    placeholderNoParent: "Şube (önce müşteri)",
    fetchOptions: (customerId) =>
      branchLookupService
        .getAll({
          page: 1,
          pageSize: 200,
          sortBy: "name",
          sortOrder: "asc",
          filters: { isActive: "true", customerId },
        })
        .then((r) => r.data),
    getLabel: (it) => {
      const b = it as Partial<BranchLookupItem> & { id: string };
      if (!b.name) return b.id;
      return b.city ? `${b.name} (${b.city})` : b.name;
    },
  },
  {
    kind: "dateRange",
    label: "Tarih",
    defaultField: "createdAt",
    fieldOptions: [
      { value: "createdAt", label: "Oluşturma" },
      { value: "dispatchedAt", label: "Sevk" },
      { value: "readyAt", label: "Hazır" },
    ],
  },
];

export function ShipmentsPage() {
  const [selected, setSelected] = useState<ShipmentListItem | null>(null);

  const { table, query, search, setSearch, pagination } = useDataTable<ShipmentListItem>({
    queryKey: QUERY_KEY,
    fetchFn: shipmentService.listCursor,
    columns: shipmentColumns,
    defaultPageSize: 50,
    enableSelection: false,
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Sevkiyatlar"
        description="Müşteri sevkiyatları — hazırlanan, hazır ve sevk edilenler."
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />
      <DataTableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Sevkiyat no, plaka, sürücü ara..."
        table={table}
        exportName="Sevkiyatlar"
      />
      <FilterBar filters={FILTERS} defaultDateRangeDays={30} />
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

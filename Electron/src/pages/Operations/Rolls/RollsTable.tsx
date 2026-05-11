import { useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { useDataTable } from "@/hooks/useDataTable";
import { itemService } from "@/pages/Items/service";
import { customerService } from "@/pages/Customers/service";
import { colorService } from "@/pages/Colors/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { rollColumns } from "./columns";
import { rollService, ROLL_STATUS_TABS, type RollStatusTabKey } from "./service";
import { RollDetailSheet } from "./RollDetailSheet";
import type { Roll } from "./types";

const FILTERS: FilterDef[] = [
  {
    kind: "select",
    key: "isDerived",
    label: "Stok Tipi",
    options: [
      { value: "false", label: "Ham" },
      { value: "true", label: "İşlenmiş" },
    ],
  },
  {
    kind: "lookup",
    key: "baseItemId",
    label: "Ham Ürün",
    service: itemService,
    queryKey: "base-items",
    extraFilters: { isDerived: "false" },
  },
  { kind: "lookup", key: "colorId", label: "Renk", service: colorService, queryKey: "colors" },
  {
    kind: "multi-lookup",
    key: "propertyIds",
    label: "Özellik",
    service: fabricPropertyService,
    queryKey: "fabric-properties",
  },
  { kind: "numberRange", key: "width", label: "En", unit: "cm" },
  { kind: "numberRange", key: "qty", label: "Boy", unit: "mt" },
  { kind: "lookup", key: "ownerCustomerId", label: "Sahip Müşteri", service: customerService, queryKey: "customers" },
  { kind: "dateRange", label: "Tarih", defaultField: "createdAt" },
];

interface Props {
  tab: RollStatusTabKey;
}

export function RollsTable({ tab }: Props) {
  const [selected, setSelected] = useState<Roll | null>(null);

  const forceFilters = useMemo(
    () => ({ status: ROLL_STATUS_TABS[tab] }),
    [tab],
  );

  const { table, query, search, setSearch, pagination } = useDataTable<Roll>({
    queryKey: `rolls:${tab}`,
    fetchFn: rollService.listCursor,
    columns: rollColumns,
    defaultPageSize: 100,
    forceFilters,
  });

  return (
    <>
      <DataTableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Barkod ara..."
      />
      <FilterBar filters={FILTERS} />
      <DataTable<Roll>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="Top bulunamadı."
        onRowClick={setSelected}
      />
      <RollDetailSheet
        roll={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  );
}

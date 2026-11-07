// Kartelalık Stok — depodaki serbest, kartelalık işaretli toplar; seçilenler Yeni Sevk'e hazır listeyle gider.
import { useMemo } from "react";
import { Send } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { DataTable } from "@/components/data-table/DataTable";
import { useDataTable } from "@/hooks/useDataTable";
import { makeRollColumns } from "@/pages/Operations/Rolls/columns";
import { rollService } from "@/pages/Operations/Rolls/service";
import type { Roll } from "@/pages/Operations/Rolls/types";
import { KARTELA_MARKED_FILTERS, rollToPicked, type KartelaPickedRoll } from "./kartelaActions";

/** Sütunlar bu sırayla: barkod · kumaş · renk · en · metre · tarih (Son İşlem). */
export const KARTELA_STOCK_COLUMN_IDS = ["barcode", "item", "color", "width", "currentQty", "updatedAt"] as const;

const SORT_ONLY = { filterKeys: [] as string[] };

const columnId = (c: ColumnDef<Roll>) => c.id ?? ("accessorKey" in c ? String(c.accessorKey) : "");

export function KartelaStockTab({ onAddToDispatch }: { onAddToDispatch: (rolls: KartelaPickedRoll[]) => void }) {
  const columns = useMemo(() => {
    const all = makeRollColumns([]);
    return KARTELA_STOCK_COLUMN_IDS.flatMap((id) => all.filter((c) => columnId(c) === id));
  }, []);
  const { table, query, pagination } = useDataTable<Roll>({
    queryKey: "rolls:KARTELA_STOCK",
    queryKeyParts: ["rolls", "KARTELA_STOCK"],
    fetchFn: rollService.listCursor,
    columns,
    defaultPageSize: 100,
    forceFilters: KARTELA_MARKED_FILTERS,
    defaultSortBy: "updatedAt",
    // Süzgeç yok; yalnız son sıralama hatırlanır (anahtar `rolls:KARTELA_STOCK`).
    persistFilters: SORT_ONLY,
  });
  return (
    <DataTable<Roll>
      table={table}
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      pagination={pagination}
      emptyText="Kartelalık top yok."
      bulkActions={(rows) => (
        <PermissionGate permission="kartela:write">
          <Button
            size="sm"
            className="h-8 gap-1.5"
            disabled={rows.length === 0}
            onClick={() => {
              onAddToDispatch(rows.map(rollToPicked));
              table.resetRowSelection();
            }}
          >
            <Send className="h-3.5 w-3.5" /> Sevke ekle
          </Button>
        </PermissionGate>
      )}
    />
  );
}

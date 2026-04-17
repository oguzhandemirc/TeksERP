import type { Table as TanstackTable, Row } from "@tanstack/react-table";
import { Checkbox } from "@/components/ui/checkbox";

export function getSelectionColumn<TData>() {
  return {
    id: "select",
    header: ({ table }: { table: TanstackTable<TData> }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        onCheckedChange={(checked) =>
          table.toggleAllPageRowsSelected(checked)
        }
        aria-label="Tümünü seç"
      />
    ),
    cell: ({ row }: { row: Row<TData> }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(checked) => row.toggleSelected(checked)}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        aria-label="Satır seç"
      />
    ),
    size: 40,
    enableSorting: false,
    enableResizing: false,
  };
}

import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import type { FabricProperty } from "./types";

export const fabricPropertyColumns: ColumnDef<FabricProperty>[] = [
  {
    id: "swatch",
    header: "",
    size: 40,
    cell: ({ row }) =>
      row.original.color ? (
        <div className="h-4 w-4 rounded" style={{ backgroundColor: row.original.color }} />
      ) : (
        <div className="h-4 w-4 rounded border border-dashed" />
      ),
  },
  {
    accessorKey: "code",
    header: () => <SortableHeader field="code" label="Kod" />,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
  },
  {
    accessorKey: "name",
    header: () => <SortableHeader field="name" label="Ad" />,
  },
  {
    accessorKey: "category",
    header: () => <SortableHeader field="category" label="Kategori" />,
    cell: ({ row }) =>
      row.original.category ? (
        <Badge variant="muted">{row.original.category}</Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "sortOrder",
    header: () => <SortableHeader field="sortOrder" label="Sıra" />,
  },
  {
    accessorKey: "isActive",
    header: () => <SortableHeader field="isActive" label="Durum" />,
    cell: ({ row }) => (row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
  },
];

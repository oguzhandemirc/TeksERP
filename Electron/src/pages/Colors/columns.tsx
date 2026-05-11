import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import type { Color } from "./types";

export const colorColumns: ColumnDef<Color>[] = [
  {
    id: "swatch",
    header: "",
    size: 40,
    cell: ({ row }) =>
      row.original.hex ? (
        <div className="h-5 w-5 rounded-full border" style={{ backgroundColor: row.original.hex }} />
      ) : (
        <div className="h-5 w-5 rounded-full border border-dashed" />
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
    accessorKey: "hex",
    header: () => <SortableHeader field="hex" label="HEX" />,
    cell: ({ row }) =>
      row.original.hex ? (
        <span className="font-mono text-xs">{row.original.hex}</span>
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

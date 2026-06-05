import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import type { ReturnReason } from "./types";

export const returnReasonColumns: ColumnDef<ReturnReason>[] = [
  {
    id: "swatch",
    header: "",
    size: 40,
    cell: ({ row }) =>
      row.original.color ? (
        <div className="h-5 w-5 rounded-full border" style={{ backgroundColor: row.original.color }} />
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
    accessorKey: "description",
    header: () => <SortableHeader field="description" label="Açıklama" />,
    cell: ({ row }) =>
      row.original.description ? (
        <span className="text-xs text-muted-foreground">{row.original.description}</span>
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

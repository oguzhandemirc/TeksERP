import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { NameWithColor } from "@/components/ui/color-dot";
import type { ReturnReason } from "./types";

export const returnReasonColumns: ColumnDef<ReturnReason>[] = [
  // Renk noktası adın önünde (40 px sütunda yarım kesiliyordu); kod ikinci, soluk.
  {
    accessorKey: "name",
    header: () => <SortableHeader field="name" label="Ad" />,
    cell: ({ row }) => <NameWithColor name={row.original.name} color={row.original.color} />,
  },
  {
    accessorKey: "code",
    header: () => <SortableHeader field="code" label="Kod" />,
    cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.code}</span>,
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

import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { stationKindLabels, stationTypeLabels } from "@/types/enums";
import type { Station } from "./types";

export const stationColumns: ColumnDef<Station>[] = [
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
    accessorKey: "type",
    header: () => <SortableHeader field="type" label="Tip" />,
    cell: ({ row }) => (
      <Badge variant={row.original.type === "INTERNAL" ? "default" : "secondary"}>
        {stationTypeLabels[row.original.type]}
      </Badge>
    ),
  },
  {
    accessorKey: "kind",
    header: () => <SortableHeader field="kind" label="Görev" />,
    cell: ({ row }) => <Badge variant="muted">{stationKindLabels[row.original.kind]}</Badge>,
  },
  {
    accessorKey: "department",
    header: () => <SortableHeader field="department" label="Departman" />,
    cell: ({ row }) => row.original.department ?? <span className="text-muted-foreground">—</span>,
  },
  {
    accessorKey: "isActive",
    header: () => <SortableHeader field="isActive" label="Durum" />,
    cell: ({ row }) => (row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
  },
];

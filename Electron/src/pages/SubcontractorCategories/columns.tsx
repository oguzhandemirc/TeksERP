import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import type { SubcontractorCategory } from "./types";

export const subcontractorCategoryColumns: ColumnDef<SubcontractorCategory>[] = [
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
    id: "subcontractorCount",
    header: "Firma",
    cell: ({ row }) => (
      <Badge variant="muted">{row.original._count?.subcontractors ?? 0}</Badge>
    ),
  },
  {
    id: "appliesColor",
    header: "Renk verir",
    cell: ({ row }) =>
      row.original.appliesColor ? (
        <Badge>Evet</Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "appliesProperty",
    header: "Özellik verir",
    cell: ({ row }) =>
      row.original.appliesProperty ? (
        <Badge>Evet</Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "description",
    header: "Açıklama",
    cell: ({ row }) =>
      row.original.description ? (
        <span className="line-clamp-1 text-sm text-muted-foreground">{row.original.description}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "isActive",
    header: () => <SortableHeader field="isActive" label="Durum" />,
    cell: ({ row }) => (row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
  },
];

import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { usageCount, type ClassTypeRow } from "./types";
import { CLASS_TYPE_KINDS, type ClassTypeKind } from "./kinds";

export function classTypeColumns(kind: ClassTypeKind): ColumnDef<ClassTypeRow>[] {
  const cfg = CLASS_TYPE_KINDS[kind];
  return [
    { accessorKey: "name", header: () => <SortableHeader field="name" label="Ad" /> },
    ...(cfg.hasAbbreviation
      ? [
          {
            id: "abbreviation",
            header: "Kısaltma",
            cell: ({ row }) => {
              const a = (row.original as { abbreviation?: string | null }).abbreviation;
              return a ? <span className="font-mono text-xs">{a}</span> : <span className="text-muted-foreground">—</span>;
            },
          } satisfies ColumnDef<ClassTypeRow>,
        ]
      : []),
    {
      accessorKey: "sortOrder",
      header: () => <SortableHeader field="sortOrder" label="Sıra" />,
      cell: ({ row }) => <span className="tabular-nums">{row.original.sortOrder}</span>,
    },
    {
      id: "usage",
      header: cfg.usageHeader,
      meta: { exportValue: (r: ClassTypeRow) => String(usageCount(r)) },
      cell: ({ row }) => <Badge variant="muted">{usageCount(row.original)}</Badge>,
    },
    {
      accessorKey: "isActive",
      header: () => <SortableHeader field="isActive" label="Durum" />,
      cell: ({ row }) => (row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
    },
  ];
}

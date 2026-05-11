import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { defectSeverityLabels } from "@/types/enums";
import type { DefectType } from "./types";

const severityVariant: Record<string, "default" | "secondary" | "destructive" | "muted"> = {
  MINOR: "muted",
  MAJOR: "secondary",
  CRITICAL: "destructive",
};

export const defectTypeColumns: ColumnDef<DefectType>[] = [
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
    accessorKey: "severity",
    header: () => <SortableHeader field="severity" label="Şiddet" />,
    cell: ({ row }) => {
      const s = row.original.severity;
      if (!s) return <span className="text-muted-foreground">—</span>;
      return <Badge variant={severityVariant[s] ?? "muted"}>{defectSeverityLabels[s]}</Badge>;
    },
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

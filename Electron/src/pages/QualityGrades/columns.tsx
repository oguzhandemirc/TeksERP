import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import type { QualityGrade, QualityTargetStatus } from "./types";

const TARGET_STATUS_LABELS: Record<QualityTargetStatus, string> = {
  WAREHOUSE: "Depo",
  A1_STOCK: "A1 Stok",
  SCRAP: "Fire",
};

export const qualityGradeColumns: ColumnDef<QualityGrade>[] = [
  {
    id: "color",
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
    accessorKey: "sortOrder",
    header: () => <SortableHeader field="sortOrder" label="Sıra" />,
  },
  {
    accessorKey: "targetStatus",
    header: () => <SortableHeader field="targetStatus" label="Hedef" />,
    cell: ({ row }) => (
      <Badge variant={row.original.targetStatus === "SCRAP" ? "destructive" : "outline"}>
        {TARGET_STATUS_LABELS[row.original.targetStatus]}
      </Badge>
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

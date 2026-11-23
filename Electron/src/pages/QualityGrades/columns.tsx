import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { NameWithColor } from "@/components/ui/color-dot";
import type { QualityGrade, QualityTargetStatus } from "./types";

const TARGET_STATUS_LABELS: Record<QualityTargetStatus, string> = {
  WAREHOUSE: "Depo",
  A1_STOCK: "A1 Stok",
  // "Ham Stok" DEĞİL: statü `STOCK`; topun hangi envanter sekmesinde görüneceğini
  // giriş kaynağı belirler (ham → Ham Stok, yarı mamul → Yarı Mamul).
  STOCK: "Stok (üretime devam)",
  SCRAP: "Fire",
};

export const qualityGradeColumns: ColumnDef<QualityGrade>[] = [
  // Ad birincil (renk noktası adın önünde), kod ikinci ve soluk — ayrı başlıksız renk sütunu yok.
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

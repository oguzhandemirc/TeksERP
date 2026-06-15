import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import type { LabelFormatProfile } from "./types";

const n = (v: string | number) => Number(v);

export const labelFormatProfileColumns: ColumnDef<LabelFormatProfile>[] = [
  {
    id: "code",
    header: "Kod / Ad",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="font-mono text-xs">{row.original.code}</div>
        <div className="truncate text-[11px] text-muted-foreground">{row.original.name}</div>
      </div>
    ),
  },
  {
    id: "media",
    header: "Medya (mm)",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {n(row.original.widthMm)} × {n(row.original.heightMm)}
      </span>
    ),
  },
  {
    id: "margin",
    header: "Pay",
    cell: ({ row }) => <span className="tabular-nums">{n(row.original.marginMm)} mm</span>,
  },
  {
    id: "content",
    header: "İçerik (mm)",
    cell: ({ row }) => {
      const w = n(row.original.widthMm) - n(row.original.marginMm) * 2;
      const h = n(row.original.heightMm) - n(row.original.marginMm) * 2;
      return (
        <span className="tabular-nums text-muted-foreground">
          {w} × {h}
        </span>
      );
    },
  },
  { accessorKey: "dpi", header: "DPI", cell: ({ row }) => <span className="tabular-nums">{row.original.dpi}</span> },
  {
    accessorKey: "orientation",
    header: "Yön",
    cell: ({ row }) => (
      <Badge variant="muted">{row.original.orientation === "PORTRAIT" ? "Dikey" : "Yatay"}</Badge>
    ),
  },
  {
    accessorKey: "isActive",
    header: "Durum",
    cell: ({ row }) => (row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
  },
];

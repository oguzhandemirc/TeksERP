import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import type { WarpSpec } from "./types";
import { formatQty } from "@/lib/format";
import { yarnLetter } from "@/pages/Operations/WarpPlan/warp-plan-model";

/** Sayıyı Türkçe biçimde bas; boş/parse edilemez değer için tire. */
function num(v: string | number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? formatQty(n, digits) : "—";
}

export const warpSpecColumns: ColumnDef<WarpSpec>[] = [
  {
    accessorKey: "code",
    header: () => <SortableHeader field="code" label="Kod" />,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
  },
  {
    accessorKey: "name",
    header: () => <SortableHeader field="name" label="Çözgü kartı" />,
  },
  {
    id: "yarn",
    header: "Çözgü ipliği",
    cell: ({ row }) => {
      const rows = row.original.yarns ?? [];
      // Çok iplikli kart: kolon özeti tek ipliği gösterir, asıl bilgi satırlardadır (harf · iplik · tel).
      if (rows.length > 1) {
        return (
          <span className="flex flex-col text-xs">
            {[...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((r, i) => (
              <span key={r.yarnItemId}>
                <span className="font-mono font-semibold">{yarnLetter(i)}</span> {r.yarnItem?.name ?? "—"}
                <span className="text-muted-foreground"> · {num(r.endsCount)} tel</span>
              </span>
            ))}
            {row.original.sequenceNote ? <span className="text-muted-foreground">Dizilim: {row.original.sequenceNote}</span> : null}
          </span>
        );
      }
      const y = row.original.yarnItem;
      if (!y) return <span className="text-muted-foreground">—</span>;
      return (
        <span className="flex flex-col">
          <span>{y.name}</span>
          <span className="text-muted-foreground text-xs">
            <span className="font-mono">{y.code}</span>
            {y.linearDensityDen ? ` · ${num(y.linearDensityDen, 2)} den` : " · denye YOK"}
          </span>
        </span>
      );
    },
  },
  {
    accessorKey: "endsCount",
    header: () => <SortableHeader field="endsCount" label="Tel adedi" />,
    cell: ({ row }) => <span className="tabular-nums">{num(row.original.endsCount)}</span>,
  },
  {
    id: "reed",
    header: "Tarak",
    cell: ({ row }) => {
      const { reedNo, endsPerDent, reedWidthCm } = row.original;
      if (!reedNo && !endsPerDent && !reedWidthCm) {
        return <span className="text-muted-foreground">—</span>;
      }
      return (
        <span className="text-xs tabular-nums">
          {reedNo ? `No ${num(reedNo, 2)}` : "—"}
          {endsPerDent ? ` · ${endsPerDent} tel/diş` : ""}
          {reedWidthCm ? ` · ${num(reedWidthCm, 2)} cm` : ""}
        </span>
      );
    },
  },
  {
    accessorKey: "isActive",
    header: "Durum",
    cell: ({ row }) =>
      row.original.isActive ? (
        <Badge variant="default">Aktif</Badge>
      ) : (
        <Badge variant="muted">Pasif</Badge>
      ),
  },
];

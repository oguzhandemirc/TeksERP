import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { WARP_BEAM_ORIGIN_LABEL, WARP_BEAM_STATUS_META, WARP_KG_SOURCE_LABEL, formatKg, formatM, type WarpBeam } from "./types";

/** Sıralama başlığı YOK: uç en yeni önce sıralar; süzme sunucuda. */
/** Liste hücresi: sarılmamış levent "—", lotsuz sarım "Lot yok", tek lot adı, N lot sayı. */
export function lotSummary(b: Pick<WarpBeam, "lots" | "wound">): string {
  if (!b.wound) return "—";
  if (b.lots.length === 0) return "Lot yok";
  if (b.lots.length === 1) return b.lots[0]!;
  return `${b.lots.length} lot`;
}

export const warpBeamColumns: ColumnDef<WarpBeam>[] = [
  { accessorKey: "beamNo", header: "Levent No", cell: ({ row }) => <span className="font-mono text-xs">{row.original.beamNo}</span> },
  {
    id: "spec",
    header: "Çözgü kartı",
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span>{row.original.warpSpec.name}</span>
        <span className="text-muted-foreground text-xs">
          <span className="font-mono">{row.original.warpSpec.code}</span> · {row.original.warpSpec.endsCount} tel · {row.original.warpSpec.yarnItem.name}
        </span>
      </span>
    ),
  },
  {
    id: "origin",
    header: "Köken",
    cell: ({ row }) => {
      const r = row.original;
      const party = r.subcontractor?.name ?? r.supplier?.name;
      return (
        <span className="flex flex-col text-xs">
          <span>{WARP_BEAM_ORIGIN_LABEL[r.originKind]}</span>
          {party && <span className="text-muted-foreground">{party}</span>}
        </span>
      );
    },
  },
  {
    id: "length",
    header: "Metre",
    cell: ({ row }) => {
      const r = row.original;
      return (
        <span className="flex flex-col font-mono text-xs">
          <span>{r.wound ? formatM(r.wound.lengthM) : `plan ${formatM(r.plannedLengthM)}`}</span>
          {r.wound && <span className="text-muted-foreground">{formatKg(r.wound.theoreticalKg)} · {r.wound.kgSource ? WARP_KG_SOURCE_LABEL[r.wound.kgSource] : ""}</span>}
        </span>
      );
    },
  },
  {
    id: "machine",
    header: "Devere / gövde",
    cell: ({ row }) => (
      <span className="flex flex-col text-xs">
        <span>{row.original.wound?.machine?.name ?? "—"}</span>
        {row.original.physicalBeamNo && <span className="text-muted-foreground font-mono">{row.original.physicalBeamNo}</span>}
      </span>
    ),
  },
  {
    // Devere Faz 2: lot özeti — tek lot adıyla, N lot sayıyla, lotsuz sarım AÇIKÇA "Lot yok" (iz eksik).
    id: "lots",
    header: "Lot",
    cell: ({ row }) => <span className="text-xs font-mono" title={row.original.lots.join(", ")}>{lotSummary(row.original)}</span>,
  },
  {
    accessorKey: "status",
    header: "Durum",
    cell: ({ row }) => <Badge className={WARP_BEAM_STATUS_META[row.original.status].badgeClass}>{WARP_BEAM_STATUS_META[row.original.status].label}</Badge>,
  },
];

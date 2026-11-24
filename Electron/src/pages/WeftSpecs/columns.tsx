// Atkı kartları — tablo sütunları (ortak DataTable). "Kumaş" sütunu kartı kullanan kumaş sayısıdır (sunucu sayar).
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { formatQty } from "@/lib/format";
import type { WeftSpecListRow } from "@/pages/WeaveDesigns/types";
import { weftLetter } from "@/pages/WeaveDesigns/tabs/WeftContentFields";

const right = (label: string) => ({ label, align: "right" as const });

function yarnSummary(r: WeftSpecListRow): string {
  return [...r.yarns].sort((a, b) => a.sortOrder - b.sortOrder).map((y, i) => `${weftLetter(i)} ${y.yarnItem?.name ?? "—"}`).join(" · ");
}

export const WEFT_SPEC_COLUMNS: ColumnDef<WeftSpecListRow>[] = [
  { id: "code", header: "Kod", meta: { label: "Kod" }, accessorFn: (r) => r.code, cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span> },
  { id: "name", header: "Ad", size: 220, meta: { label: "Ad" }, accessorFn: (r) => r.name },
  {
    id: "yarns",
    header: "Atkı iplikleri",
    size: 280,
    meta: { label: "Atkı iplikleri" },
    accessorFn: yarnSummary,
    cell: ({ row }) => (
      <span className="flex flex-col text-xs">
        {[...row.original.yarns].sort((a, b) => a.sortOrder - b.sortOrder).map((y, i) => (
          <span key={`${y.yarnItemId}-${i}`}>
            <span className="font-mono font-semibold">{weftLetter(i)}</span> {y.yarnItem?.name ?? "—"}
            <span className="text-muted-foreground"> · raporda {y.picksInRepeat}</span>
          </span>
        ))}
      </span>
    ),
  },
  { id: "seq", header: "Atkı sırası", meta: { label: "Atkı sırası" }, accessorFn: (r) => r.sequenceCode ?? "—", cell: ({ row }) => <span className="font-mono text-xs">{row.original.sequenceCode ?? "—"}</span> },
  {
    id: "ppc",
    header: "Sıklık (atkı/cm)",
    meta: right("Sıklık (atkı/cm)"),
    accessorFn: (r) => (r.picksPerCm == null || r.picksPerCm === "" ? "—" : formatQty(Number(r.picksPerCm), 2)),
  },
  { id: "program", header: "Program no", meta: { label: "Program no" }, accessorFn: (r) => r.weftProgramNo ?? "—" },
  {
    id: "fabrics",
    header: "Kullanıldığı kumaş",
    meta: right("Kullanıldığı kumaş"),
    accessorFn: (r) => r.fabricCount,
    cell: ({ row }) => <span className="tabular-nums">{row.original.fabricCount === 0 ? "—" : `${row.original.fabricCount} kumaş`}</span>,
  },
  {
    id: "active",
    header: "Durum",
    meta: { label: "Durum", exportValue: (r) => (r.isActive ? "Aktif" : "Pasif") },
    accessorFn: (r) => r.isActive,
    cell: ({ row }) => (row.original.isActive ? <Badge variant="default">Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
  },
];

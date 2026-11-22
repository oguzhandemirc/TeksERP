import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DevereStaleAgeCell, statusAgeText } from "@/components/data-table/StatusAgeCell";
import { cn } from "@/lib/utils";
import { dimsText, ownerText, placeText } from "./model";
import { beamBodyStatusMeta, type BeamBody } from "./types";

/** Sıralama başlığı YOK: uç gövde no sırasıyla döner; süzme sunucuda. Ad birincil, kod ikincil. */
export const beamBodyColumns: ColumnDef<BeamBody>[] = [
  {
    accessorKey: "bodyNo",
    header: "Gövde no",
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        <span className="font-mono text-sm font-medium">{row.original.bodyNo}</span>
        {!row.original.isActive && <Badge variant="outline" className="font-normal">Pasif</Badge>}
      </span>
    ),
  },
  {
    id: "owner",
    header: "Sahibi",
    meta: { exportValue: (r: BeamBody) => ownerText(r.owner) },
    cell: ({ row }) => {
      const o = row.original.owner;
      if (o.kind === "OURS" || !o.customer) return <span>{o.label}</span>;
      return (
        <span className="flex flex-col">
          <span>{o.customer.name}</span>
          <span className="text-xs text-muted-foreground">{o.label}</span>
        </span>
      );
    },
  },
  { id: "dims", header: "En · flanş · dara", meta: { exportValue: (r: BeamBody) => dimsText(r) }, cell: ({ row }) => <span className="tabular-nums text-sm">{dimsText(row.original)}</span> },
  {
    id: "status",
    header: "Durum",
    meta: { exportValue: (r: BeamBody) => beamBodyStatusMeta(r.status, r.statusLabel).label },
    cell: ({ row }) => {
      const m = beamBodyStatusMeta(row.original.status, row.original.statusLabel);
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge className={cn("font-normal", m.badgeClass)}>{m.label}</Badge>
          {row.original.ownerReturnDue && <Badge variant="outline" className="border-amber-400 font-normal text-amber-700 dark:text-amber-300">Sahibine iade edilecek</Badge>}
        </span>
      );
    },
  },
  {
    // S4: "X gündür deverecide / iade bekliyor" — dışarıdaki ya da iade bekleyen gövdede eşik üstü uyarı rengi.
    id: "age",
    header: "Bu durumda",
    meta: { exportValue: (r: BeamBody) => statusAgeText(r.statusAgeDays) },
    cell: ({ row }) => {
      const r = row.original;
      const watch = r.status === "AT_SUBCONTRACTOR" || r.status === "FULL_OUT" || r.ownerReturnDue;
      return <DevereStaleAgeCell days={r.statusAgeDays} since={r.statusSince} watch={!!watch} kind="outBody" />;
    },
  },
  { id: "place", header: "Nerede", meta: { exportValue: (r: BeamBody) => placeText(r.place) }, cell: ({ row }) => placeText(row.original.place) },
  {
    id: "machines",
    header: "Uyumlu tezgâhlar",
    meta: { exportValue: (r: BeamBody) => r.machineFits.map((m) => m.code).join(", ") },
    cell: ({ row }) => {
      const m = row.original.machineFits;
      if (m.length === 0) return <span className="text-muted-foreground" title="Liste boş: her tezgâha uyar sayılır">Hepsi</span>;
      const shown = m.slice(0, 3).map((x) => x.code).join(", ");
      return <span title={m.map((x) => `${x.code} ${x.name}`).join("\n")}>{m.length > 3 ? `${shown} +${m.length - 3}` : shown}</span>;
    },
  },
];

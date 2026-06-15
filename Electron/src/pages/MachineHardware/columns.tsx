import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import type { MachineHardware } from "./types";

const mono = (v: string | null) =>
  v ? <span className="font-mono text-xs">{v}</span> : <span className="text-muted-foreground">—</span>;

export const machineHardwareColumns: ColumnDef<MachineHardware>[] = [
  {
    id: "machine",
    header: "Makine",
    cell: ({ row }) =>
      row.original.machine ? (
        <div className="min-w-0">
          <div className="truncate">{row.original.machine.name}</div>
          <div className="font-mono text-[10px] text-muted-foreground">{row.original.machine.code}</div>
        </div>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  { id: "printerIp", header: "Yazıcı IP", cell: ({ row }) => mono(row.original.printerIp) },
  { id: "printerMac", header: "Yazıcı MAC", cell: ({ row }) => mono(row.original.printerMac) },
  { id: "kqMac", header: "KQ MAC", cell: ({ row }) => mono(row.original.kqMac) },
  { id: "mtMac", header: "MT MAC", cell: ({ row }) => mono(row.original.mtMac) },
  {
    id: "patterns",
    header: "Desen (KQ / MT)",
    cell: ({ row }) => (
      <span className="font-mono text-[10px] text-muted-foreground">
        {row.original.kqPattern || "—"} / {row.original.mtPattern || "—"}
      </span>
    ),
  },
  {
    id: "printer",
    header: "Yazıcı / Profil",
    cell: ({ row }) =>
      row.original.printerModel ? (
        <div className="min-w-0">
          <div className="truncate text-xs">{row.original.printerModel.name}</div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {row.original.formatProfile?.code ?? "(model default)"}
          </div>
        </div>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "isActive",
    header: "Durum",
    cell: ({ row }) =>
      row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>,
  },
];

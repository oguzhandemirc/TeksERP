import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import type { MachineStopCodeMap } from "./types";

export const codeMapColumns: ColumnDef<MachineStopCodeMap>[] = [
  {
    accessorKey: "collectorType",
    header: () => <SortableHeader field="collectorType" label="Kart tipi" />,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.collectorType}</span>,
  },
  {
    accessorKey: "rawStopCode",
    header: () => <SortableHeader field="rawStopCode" label="Ham kod" />,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.rawStopCode}</span>,
  },
  {
    id: "scope",
    header: "Kapsam",
    cell: ({ row }) =>
      row.original.machine ? (
        <span>{row.original.machine.code} <span className="text-xs text-muted-foreground">(tezgah üst-yazımı)</span></span>
      ) : (
        <span className="text-muted-foreground">Kart tipi geneli</span>
      ),
  },
  {
    id: "stopReason",
    header: "Duruş sebebi",
    cell: ({ row }) => (
      <span>
        {row.original.stopReason.label} <span className="font-mono text-xs text-muted-foreground">{row.original.stopReason.code}</span>
        {!row.original.stopReason.isActive && <Badge variant="destructive" className="ml-2">Sebep pasif</Badge>}
      </span>
    ),
  },
  {
    accessorKey: "isActive",
    header: () => <SortableHeader field="isActive" label="Durum" />,
    cell: ({ row }) => (row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
  },
];

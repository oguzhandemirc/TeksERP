import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { MachineQrCell } from "./MachineQrPrintDialog";
import { MachineLabelCell } from "./MachineLabelPrintDialog";
import type { Machine } from "./types";

export const machineColumns: ColumnDef<Machine>[] = [
  // O25: ad birincil, kod ikinci ve soluk.
  {
    accessorKey: "name",
    header: () => <SortableHeader field="name" label="Ad" />,
  },
  {
    accessorKey: "code",
    header: () => <SortableHeader field="code" label="Kod" />,
    cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.code}</span>,
  },
  {
    id: "station",
    header: "İstasyon",
    cell: ({ row }) =>
      row.original.station?.name ?? <span className="text-muted-foreground">—</span>,
  },
  {
    accessorKey: "isActive",
    header: () => <SortableHeader field="isActive" label="Durum" />,
    cell: ({ row }) => (row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
  },
  // QR + tezgah etiketi tek "Baskı" sütununda (iki ayrı düğme sütunu yerine).
  {
    id: "print",
    header: "Baskı",
    meta: { noExport: true },
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <MachineQrCell machine={row.original} />
        <MachineLabelCell machine={row.original} />
      </div>
    ),
  },
];

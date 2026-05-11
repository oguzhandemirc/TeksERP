import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, shipmentStatusTones } from "@/components/operations/StatusBadge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { shipmentStatusLabels } from "@/types/enums";
import { safeFormat } from "@/lib/format";
import type { Shipment } from "./types";

function customerName(s: Shipment): string {
  return s.customer?.name ?? s.customerNameSnapshot ?? "—";
}

export const shipmentColumns: ColumnDef<Shipment>[] = [
  {
    accessorKey: "shipmentNumber",
    header: () => <SortableHeader field="shipmentNumber" label="Sevk No" />,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.shipmentNumber}</span>,
  },
  {
    id: "customer",
    header: "Müşteri",
    cell: ({ row }) => customerName(row.original),
  },
  {
    accessorKey: "shippedAt",
    header: () => <SortableHeader field="shippedAt" label="Sevk Tarihi" />,
    cell: ({ row }) => {
      const s = row.original;
      return s.shippedAt ? (
        <span className="text-xs tabular-nums">{safeFormat(s.shippedAt, "dd.MM.yyyy")}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  },
  {
    accessorKey: "plannedDate",
    header: () => <SortableHeader field="plannedDate" label="Planlı Sevk" />,
    cell: ({ row }) =>
      row.original.plannedDate ? (
        <span className="text-xs tabular-nums">
          {safeFormat(row.original.plannedDate, "dd.MM.yyyy")}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "createdAt",
    header: () => <SortableHeader field="createdAt" label="Oluşturma" />,
    cell: ({ row }) => (
      <span className="text-xs tabular-nums">{safeFormat(row.original.createdAt, "dd.MM.yyyy")}</span>
    ),
  },
  {
    id: "items",
    header: "Top",
    cell: ({ row }) => (
      <Badge variant="muted">{row.original._count?.items ?? row.original.items?.length ?? 0}</Badge>
    ),
  },
  {
    accessorKey: "carrier",
    header: () => <SortableHeader field="carrier" label="Nakliye" />,
    cell: ({ row }) =>
      row.original.carrier ? (
        <span className="text-xs">{row.original.carrier}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "status",
    header: () => <SortableHeader field="status" label="Durum" />,
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.status}
        labels={shipmentStatusLabels}
        tones={shipmentStatusTones}
      />
    ),
  },
];

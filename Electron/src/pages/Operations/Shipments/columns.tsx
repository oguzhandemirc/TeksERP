import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { safeFormat } from "@/lib/format";
import {
  shipmentStatusLabels,
  shipmentStatusTones,
  type ShipmentListItem,
} from "./types";

export const shipmentColumns: ColumnDef<ShipmentListItem>[] = [
  {
    accessorKey: "shipmentNo",
    header: "Sevkiyat No",
    cell: ({ row }) => (
      <span className="font-mono text-xs font-semibold">{row.original.shipmentNo}</span>
    ),
  },
  {
    id: "customer",
    header: "Müşteri",
    cell: ({ row }) => {
      const s = row.original;
      return (
        <div className="min-w-0">
          <div className="truncate font-medium">{s.customer.name}</div>
          {s.branch && (
            <div className="truncate text-xs text-muted-foreground">{s.branch.name}</div>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Durum",
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.status}
        labels={shipmentStatusLabels}
        tones={shipmentStatusTones}
      />
    ),
  },
  {
    id: "counts",
    header: "İçerik",
    cell: ({ row }) => {
      const c = row.original._count;
      return (
        <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {c.orders} sipariş · {c.rolls} top · {c.sacks} çuval
        </span>
      );
    },
  },
  {
    id: "vehicle",
    header: "Araç / Sürücü",
    cell: ({ row }) => {
      const s = row.original;
      if (!s.plateNumber && !s.driverName) {
        return <span className="text-muted-foreground">—</span>;
      }
      return (
        <span className="text-xs">
          {s.plateNumber ?? ""}
          {s.driverName ? ` · ${s.driverName}` : ""}
        </span>
      );
    },
  },
  {
    id: "date",
    header: "Tarih",
    cell: ({ row }) => {
      const s = row.original;
      const d = s.dispatchedAt ?? s.readyAt ?? s.createdAt;
      return (
        <span className="whitespace-nowrap text-xs tabular-nums">
          {safeFormat(d, "dd.MM.yyyy HH:mm")}
        </span>
      );
    },
  },
];

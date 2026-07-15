import type { ColumnDef } from "@tanstack/react-table";
import { Undo2 } from "lucide-react";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { safeFormat } from "@/lib/format";
import { shipmentStatusLabels, shipmentStatusTones, type ShipmentListItem } from "./types";

export const shipmentColumns: ColumnDef<ShipmentListItem>[] = [
  {
    accessorKey: "shipmentNo",
    header: "Sevkiyat No",
    cell: ({ row }) => {
      const s = row.original;
      return (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-semibold">{s.shipmentNo}</span>
          {s.kind === "DIRECT" && (
            <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-600">
              Fasondan Doğrudan
            </Badge>
          )}
        </div>
      );
    },
  },
  {
    id: "customer",
    header: "Müşteri",
    cell: ({ row }) => {
      const s = row.original;
      return (
        <div className="min-w-0">
          <div className="truncate font-medium">{s.customer.name}</div>
          {s.branch && <div className="truncate text-xs text-muted-foreground">{s.branch.name}</div>}
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Durum",
    cell: ({ row }) => (
      <StatusBadge status={row.original.status} labels={shipmentStatusLabels} tones={shipmentStatusTones} />
    ),
  },
  {
    id: "counts",
    header: "İçerik",
    cell: ({ row }) => {
      const c = row.original._count;
      const isDirect = row.original.kind === "DIRECT";
      return (
        <span className="flex items-center gap-1.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {/* Doğrudan sevkte çuval yok — top (+ karşılanan sipariş) gösterilir. */}
          {isDirect
            ? `${c.rolls} top${c.orders > 0 ? ` · ${c.orders} sipariş` : ""}`
            : `${c.orders} sipariş · ${c.rolls} top · ${c.sacks} çuval`}
          {c.returns > 0 && (
            <Badge
              variant="outline"
              className="gap-0.5 border-amber-500/40 px-1 py-0 text-[10px] font-normal text-amber-600"
              title="Bu sevkiyattan iade edilen top sayısı (detayda dökümü var)"
            >
              <Undo2 className="h-3 w-3" /> {c.returns} iade
            </Badge>
          )}
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
      const d = s.dispatchedAt ?? s.createdAt;
      return (
        <span className="whitespace-nowrap text-xs tabular-nums">{safeFormat(d, "dd.MM.yyyy HH:mm")}</span>
      );
    },
  },
];

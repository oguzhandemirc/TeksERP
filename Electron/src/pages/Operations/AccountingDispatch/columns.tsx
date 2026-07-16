import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { safeFormat } from "@/lib/format";
import type { DispatchListItem } from "./types";

export function buildDispatchColumns(
  onReceipt: (row: DispatchListItem) => void,
): ColumnDef<DispatchListItem>[] {
  return [
    {
      accessorKey: "shipmentNo",
      header: "Sevkiyat No",
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono">{row.original.shipmentNo}</span>
          {row.original.kind === "DIRECT" && (
            <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-600">
              Fasondan Sevk
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: "customer",
      header: "Müşteri",
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate">{row.original.customer.name}</div>
          {row.original.branch && (
            <div className="truncate text-xs text-muted-foreground">
              {row.original.branch.name}
              {row.original.branch.code && (
                <span className="ml-1 font-mono text-[10px] text-foreground/70">· {row.original.branch.code}</span>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "dispatchedAt",
      header: "Sevk Tarihi",
      cell: ({ row }) =>
        row.original.dispatchedAt ? safeFormat(row.original.dispatchedAt, "dd.MM.yyyy HH:mm") : "—",
    },
    {
      id: "counts",
      header: "İçerik",
      cell: ({ row }) => {
        const c = row.original._count;
        // Doğrudan sevkte çuval yok — top (+ karşılanan sipariş) gösterilir.
        return (
          <span className="text-xs text-muted-foreground">
            {row.original.kind === "DIRECT"
              ? `${c.rolls} top${c.orders > 0 ? ` · ${c.orders} sipariş` : ""}`
              : `${c.sacks} çuval · ${c.rolls} top`}
          </span>
        );
      },
    },
    {
      id: "receipt",
      header: "",
      size: 110,
      cell: ({ row }) => (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={(e) => {
            e.stopPropagation();
            onReceipt(row.original);
          }}
        >
          <FileText className="h-3.5 w-3.5" /> Fiş
        </Button>
      ),
    },
  ];
}

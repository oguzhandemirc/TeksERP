import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import { safeFormat } from "@/lib/format";
import type { DispatchListItem } from "./types";

export function buildDispatchColumns(
  onReceipt: (row: DispatchListItem) => void,
): ColumnDef<DispatchListItem>[] {
  return [
    {
      accessorKey: "shipmentNo",
      header: "Sevkiyat No",
      cell: ({ row }) => <span className="font-mono">{row.original.shipmentNo}</span>,
    },
    {
      id: "customer",
      header: "Müşteri",
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate">{row.original.customer.name}</div>
          {row.original.branch && (
            <div className="truncate text-xs text-muted-foreground">{row.original.branch.name}</div>
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
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original._count.sacks} çuval · {row.original._count.rolls} top
        </span>
      ),
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

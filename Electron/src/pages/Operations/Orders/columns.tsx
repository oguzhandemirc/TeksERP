import type { ColumnDef } from "@tanstack/react-table";
import { safeFormat } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, orderStatusTones } from "@/components/operations/StatusBadge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { orderStatusLabels } from "@/types/enums";
import type { Order } from "./types";

export function buildOrderColumns(pricingEnabled: boolean): ColumnDef<Order>[] {
  return [
    ...orderColumns,
    ...(pricingEnabled
      ? [
          {
            id: "totalAmount",
            header: "Tutar",
            cell: ({ row }) => {
              const o = row.original;
              if (!o.totalAmount) {
                return <span className="text-muted-foreground text-xs">—</span>;
              }
              return (
                <span className="tabular-nums text-xs">
                  {Number(o.totalAmount).toLocaleString("tr-TR", {
                    minimumFractionDigits: 2,
                  })}{" "}
                  {o.currency}
                </span>
              );
            },
          } as ColumnDef<Order>,
        ]
      : []),
  ];
}

export const orderColumns: ColumnDef<Order>[] = [
  {
    accessorKey: "orderNumber",
    header: "Sipariş No",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.orderNumber}</span>,
  },
  {
    id: "customer",
    header: () => <SortableHeader field="customer" label="Müşteri" />,
    cell: ({ row }) =>
      row.original.customer?.name ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "branch",
    header: () => <SortableHeader field="branch" label="Şube" />,
    cell: ({ row }) =>
      row.original.branch?.name ?? <span className="text-muted-foreground">—</span>,
  },
  {
    accessorKey: "orderDate",
    header: () => <SortableHeader field="orderDate" label="Sipariş Tarihi" />,
    cell: ({ row }) => safeFormat(row.original.orderDate, "dd.MM.yyyy"),
  },
  {
    accessorKey: "deadline",
    header: () => <SortableHeader field="deadline" label="Termin" />,
    cell: ({ row }) => <DeadlineBadge deadline={row.original.deadline} />,
  },
  {
    id: "lines",
    header: () => <SortableHeader field="lineCount" label="Kalem" />,
    cell: ({ row }) => <Badge variant="muted">{row.original.lines?.length ?? 0}</Badge>,
  },
  {
    id: "shipped",
    header: () => <SortableHeader field="shippedQty" label="Sevk" />,
    cell: ({ row }) => {
      const o = row.original;
      const requested = (o.lines ?? []).reduce((s, l) => s + Number(l.quantity ?? 0), 0);
      if (requested === 0) {
        return <span className="text-muted-foreground text-xs">—</span>;
      }
      const shipped = o.shippedQty ?? 0;
      const pct = Math.min(100, Math.round((shipped / requested) * 100));
      const fmt = (n: number) =>
        n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
      return (
        <span className="tabular-nums text-xs">
          {fmt(shipped)}/{fmt(requested)} m
          <span className="text-muted-foreground ml-1">({pct}%)</span>
        </span>
      );
    },
  },
  {
    accessorKey: "status",
    header: () => <SortableHeader field="status" label="Durum" />,
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.status}
        labels={orderStatusLabels}
        tones={orderStatusTones}
      />
    ),
  },
];

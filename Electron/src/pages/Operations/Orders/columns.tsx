import type { ColumnDef } from "@tanstack/react-table";
import { safeFormat } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, orderStatusTones } from "@/components/operations/StatusBadge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { orderStatusLabels } from "@/types/enums";
import type { Order } from "./types";

export const orderColumns: ColumnDef<Order>[] = [
  {
    accessorKey: "orderNumber",
    header: "Sipariş No",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.orderNumber}</span>,
  },
  {
    id: "customer",
    header: "Müşteri",
    cell: ({ row }) =>
      row.original.customer?.name ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "branch",
    header: "Şube",
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
    header: "Kalem",
    cell: ({ row }) => <Badge variant="muted">{row.original.lines?.length ?? 0}</Badge>,
  },
  {
    accessorKey: "status",
    header: "Durum",
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.status}
        labels={orderStatusLabels}
        tones={orderStatusTones}
      />
    ),
  },
];

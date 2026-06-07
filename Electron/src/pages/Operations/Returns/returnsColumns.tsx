import type { ColumnDef } from "@tanstack/react-table";
import { safeFormat } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import type { ReturnRow } from "./service";

const DEC = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

export const returnColumns: ColumnDef<ReturnRow>[] = [
  {
    accessorKey: "createdAt",
    header: "Tarih",
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5 text-xs">
        {safeFormat(row.original.createdAt, "dd.MM.yyyy HH:mm")}
        {row.original.cancelledAt && (
          <Badge variant="destructive" className="px-1 py-0 text-[10px] leading-tight">
            İptal
          </Badge>
        )}
      </span>
    ),
  },
  {
    id: "customer",
    header: "Müşteri",
    cell: ({ row }) => row.original.customer?.name ?? "—",
  },
  {
    id: "order",
    header: "Sipariş",
    cell: ({ row }) =>
      row.original.order ? (
        <span className="font-mono text-xs">{row.original.order.orderNumber}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "item",
    header: "Ürün",
    cell: ({ row }) => (
      <div>
        <div>{row.original.item?.name ?? "—"}</div>
        {(row.original.color || row.original.width) && (
          <div className="text-xs text-muted-foreground">
            {[row.original.color?.name, row.original.width ? `${row.original.width} cm` : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
      </div>
    ),
  },
  {
    id: "barcode",
    header: "Barkod",
    cell: ({ row }) =>
      row.original.roll?.barcode ? (
        <span className="font-mono text-xs">{row.original.roll.barcode}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "qty",
    header: () => <div className="text-right">Metre</div>,
    meta: { label: "Metre" },
    cell: ({ row }) => <div className="text-right tabular-nums">{DEC.format(row.original.qty)}</div>,
  },
  {
    id: "reason",
    header: "Neden",
    cell: ({ row }) => {
      const r = row.original.reason;
      if (r) {
        return (
          <Badge
            variant="secondary"
            style={r.color ? { backgroundColor: `${r.color}22`, color: r.color } : undefined}
          >
            {r.name}
          </Badge>
        );
      }
      if (row.original.reasonText) {
        return <span className="text-xs">{row.original.reasonText}</span>;
      }
      return <span className="text-muted-foreground">—</span>;
    },
  },
  {
    id: "quality",
    header: "Kalite",
    cell: ({ row }) => row.original.qualityGrade?.name ?? "—",
  },
  {
    id: "receivedBy",
    header: "Teslim Alan",
    cell: ({ row }) => <span className="text-xs">{row.original.receivedBy?.fullName ?? "—"}</span>,
  },
];

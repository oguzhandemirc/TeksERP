import type { ColumnDef } from "@tanstack/react-table";
import { safeFormat } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, orderStatusTones } from "@/components/operations/StatusBadge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { orderStatusLabels } from "@/types/enums";
import type { Order, OrderLine } from "./types";

/**
 * Sipariş kalemlerindeki benzersiz ürün/renk etiketleri. Müşteri-bazlı ad
 * (customerItemName/customerColorName) varsa onu, yoksa master adı kullanır.
 * Renksiz kalemler renk listesine girmez.
 */
function distinctLineLabels(
  lines: OrderLine[] | undefined,
  kind: "item" | "color",
): { key: string; label: string; hex?: string | null }[] {
  const map = new Map<string, { label: string; hex?: string | null }>();
  for (const l of lines ?? []) {
    if (kind === "item") {
      const label = l.customerItemName?.trim() || l.item?.name;
      if (label && !map.has(l.itemId)) map.set(l.itemId, { label });
    } else {
      if (!l.colorId) continue;
      const label = l.customerColorName?.trim() || l.color?.name;
      if (label && !map.has(l.colorId)) map.set(l.colorId, { label, hex: l.color?.hex });
    }
  }
  return [...map.entries()].map(([key, v]) => ({ key, ...v }));
}

function LineLabelsCell({
  lines,
  kind,
}: {
  lines: OrderLine[] | undefined;
  kind: "item" | "color";
}) {
  const labels = distinctLineLabels(lines, kind);
  if (labels.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const shown = labels.slice(0, 2);
  const rest = labels.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((it) => (
        <span key={it.key} className="inline-flex items-center gap-1 text-xs">
          {kind === "color" && (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full border"
              style={{ backgroundColor: it.hex ?? "transparent" }}
            />
          )}
          <span className="truncate">{it.label}</span>
        </span>
      ))}
      {rest > 0 && <Badge variant="muted">+{rest}</Badge>}
    </div>
  );
}

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
    meta: { label: "Müşteri" },
    cell: ({ row }) =>
      row.original.customer?.name ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "branch",
    header: () => <SortableHeader field="branch" label="Şube" />,
    meta: { label: "Şube" },
    cell: ({ row }) =>
      row.original.branch?.name ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "items",
    header: "Ürün",
    meta: { label: "Ürün" },
    cell: ({ row }) => <LineLabelsCell lines={row.original.lines} kind="item" />,
  },
  {
    id: "colors",
    header: "Renk",
    meta: { label: "Renk" },
    cell: ({ row }) => <LineLabelsCell lines={row.original.lines} kind="color" />,
  },
  {
    accessorKey: "orderDate",
    header: () => <SortableHeader field="orderDate" label="Sipariş Tarihi" />,
    meta: { label: "Sipariş Tarihi" },
    cell: ({ row }) => safeFormat(row.original.orderDate, "dd.MM.yyyy"),
  },
  {
    accessorKey: "deadline",
    header: () => <SortableHeader field="deadline" label="Termin" />,
    meta: { label: "Termin" },
    cell: ({ row }) => <DeadlineBadge deadline={row.original.deadline} />,
  },
  {
    id: "lines",
    header: () => <SortableHeader field="lineCount" label="Kalem" />,
    meta: { label: "Kalem" },
    cell: ({ row }) => <Badge variant="muted">{row.original.lines?.length ?? 0}</Badge>,
  },
  {
    id: "shipped",
    header: () => <SortableHeader field="shippedQty" label="Sevk" />,
    meta: { label: "Sevk" },
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
    meta: { label: "Durum" },
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.status}
        labels={orderStatusLabels}
        tones={orderStatusTones}
      />
    ),
  },
];

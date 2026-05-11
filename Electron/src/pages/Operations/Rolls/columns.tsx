import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge, rollStatusTones } from "@/components/operations/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { safeFormat } from "@/lib/format";
import { rollStatusLabels } from "@/types/enums";
import type { Roll, RollItem } from "./types";

function ItemIdentityCell({ item }: { item?: RollItem }) {
  if (!item) return <span className="text-muted-foreground">—</span>;
  const isDerived = item.isDerived === true;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-xs font-medium">{item.name}</span>
      {!isDerived && (
        <Badge
          variant="outline"
          className="h-4 border-muted-foreground/40 px-1 py-0 text-[9px] text-muted-foreground"
        >
          Ham
        </Badge>
      )}
      {isDerived && item.color ? (
        <span
          className="inline-flex items-center gap-1 rounded border px-1 py-0 text-[10px]"
          title={item.color.name}
        >
          <span
            className="h-2 w-2 rounded-full border border-black/10"
            style={{ backgroundColor: item.color.hex ?? "#999" }}
          />
          {item.color.name}
        </span>
      ) : null}
    </div>
  );
}

export const rollColumns: ColumnDef<Roll>[] = [
  {
    accessorKey: "barcode",
    header: () => <SortableHeader field="barcode" label="Barkod" />,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.barcode}</span>,
  },
  {
    id: "item",
    header: "Ürün / Özellik",
    cell: ({ row }) => <ItemIdentityCell item={row.original.item} />,
  },
  {
    id: "variant",
    header: "Variant",
    cell: ({ row }) =>
      row.original.variant?.name ?? <span className="text-muted-foreground">—</span>,
  },
  {
    accessorKey: "currentQty",
    header: () => <SortableHeader field="currentQty" label="Metre" />,
    cell: ({ row }) => (
      <div className="text-right">
        <span className="tabular-nums">{row.original.currentQty.toLocaleString("tr-TR")}</span>
        {row.original.currentQty !== row.original.initialQty && (
          <span className="ml-1 text-[10px] text-muted-foreground">
            / {row.original.initialQty.toLocaleString("tr-TR")}
          </span>
        )}
      </div>
    ),
  },
  {
    accessorKey: "width",
    header: () => <SortableHeader field="width" label="En" />,
    cell: ({ row }) =>
      row.original.width != null ? (
        <span className="tabular-nums text-xs">{row.original.width} cm</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "qualityGrade",
    header: () => <SortableHeader field="qualityGrade" label="Kalite" />,
    cell: ({ row }) => <span className="text-xs">{row.original.qualityGrade}</span>,
  },
  {
    accessorKey: "status",
    header: () => <SortableHeader field="status" label="Durum" />,
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.status}
        labels={rollStatusLabels}
        tones={rollStatusTones}
      />
    ),
  },
  {
    accessorKey: "createdAt",
    header: () => <SortableHeader field="createdAt" label="Tarih" />,
    cell: ({ row }) => (
      <span className="text-xs tabular-nums">{safeFormat(row.original.createdAt, "dd.MM.yyyy")}</span>
    ),
  },
  {
    id: "owner",
    header: "Sahibi",
    cell: ({ row }) =>
      row.original.ownerCustomer ? (
        <span className="text-xs">{row.original.ownerCustomer.name}</span>
      ) : (
        <span className="text-muted-foreground">— (firma)</span>
      ),
  },
];

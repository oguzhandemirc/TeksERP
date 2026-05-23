import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge, rollStatusTones } from "@/components/operations/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { safeFormat } from "@/lib/format";
import { rollStatusLabels, RollStatus } from "@/types/enums";
import type { Roll } from "./types";

/**
 * Roll'un fiziksel/işlenmiş durumunu renk ve duruma göre türet.
 * - Ham: renk yok (boyahaneye girmemiş veya sevkten dönmemiş)
 * - Bitmiş: WAREHOUSE veya READY_FOR_SHIP'e ulaşmış
 * - İşleniyor: rengi var ama henüz depoya inmemiş
 */
function rollProcessingState(roll: Roll): "ham" | "isleniyor" | "bitmis" {
  if (
    roll.status === RollStatus.WAREHOUSE ||
    roll.status === RollStatus.READY_FOR_SHIP ||
    roll.status === RollStatus.SHIPPED ||
    roll.status === RollStatus.A1_STOCK
  ) {
    return "bitmis";
  }
  if (roll.colorId) return "isleniyor";
  return "ham";
}

const processingLabels: Record<ReturnType<typeof rollProcessingState>, string> = {
  ham: "Ham",
  isleniyor: "İşleniyor",
  bitmis: "Bitmiş",
};

export const rollColumns: ColumnDef<Roll>[] = [
  {
    accessorKey: "barcode",
    header: () => <SortableHeader field="barcode" label="Barkod" />,
    cell: ({ row }) =>
      row.original.barcode ? (
        <span className="font-mono text-xs">{row.original.barcode}</span>
      ) : (
        <Badge variant="outline" className="text-[10px]">
          Açık Kumaş
        </Badge>
      ),
  },
  {
    id: "item",
    header: "Ürün",
    cell: ({ row }) => (
      <span className="text-xs font-medium">
        {row.original.item?.name ?? "—"}
      </span>
    ),
  },
  {
    id: "color",
    header: "Renk",
    cell: ({ row }) =>
      row.original.color ? (
        <span className="inline-flex items-center gap-1 text-xs">
          {row.original.color.hex && (
            <span
              className="h-2.5 w-2.5 rounded-full border border-black/10"
              style={{ backgroundColor: row.original.color.hex }}
            />
          )}
          {row.original.color.name}
        </span>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      ),
  },
  {
    id: "properties",
    header: "Özellikler",
    cell: ({ row }) => {
      const props = row.original.properties ?? [];
      if (props.length === 0) {
        return <span className="text-muted-foreground text-xs">—</span>;
      }
      return (
        <div className="flex flex-wrap gap-0.5">
          {props.slice(0, 2).map((p) => (
            <Badge key={p.propertyId} variant="muted" className="text-[10px]">
              {p.property.name}
            </Badge>
          ))}
          {props.length > 2 && (
            <Badge variant="muted" className="text-[10px]">
              +{props.length - 2}
            </Badge>
          )}
        </div>
      );
    },
  },
  {
    id: "processing",
    header: "Tip",
    cell: ({ row }) => {
      const state = rollProcessingState(row.original);
      return (
        <Badge
          variant={state === "bitmis" ? "default" : "outline"}
          className="text-[10px]"
        >
          {processingLabels[state]}
        </Badge>
      );
    },
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

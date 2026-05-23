import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { itemTypeLabels } from "@/types/enums";
import type { Item } from "./types";

export const itemColumns: ColumnDef<Item>[] = [
  {
    accessorKey: "code",
    header: () => <SortableHeader field="code" label="Kod" />,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
  },
  {
    accessorKey: "name",
    header: () => <SortableHeader field="name" label="Ad" />,
  },
  {
    accessorKey: "itemType",
    header: () => <SortableHeader field="itemType" label="Tip" />,
    cell: ({ row }) => <Badge variant="muted">{itemTypeLabels[row.original.itemType]}</Badge>,
  },
  {
    accessorKey: "unit",
    header: () => <SortableHeader field="unit" label="Birim" />,
  },
  {
    id: "allowedColors",
    header: "İzinli Renkler",
    cell: ({ row }) => {
      const colors = row.original.allowedColors ?? [];
      if (colors.length === 0) {
        return <span className="text-xs text-muted-foreground italic">Tümü</span>;
      }
      return (
        <div className="flex flex-wrap gap-1">
          {colors.slice(0, 3).map((c) => (
            <Badge key={c.colorId} variant="muted" className="gap-1 text-[10px]">
              {c.color.hex && (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: c.color.hex }}
                />
              )}
              {c.color.name}
            </Badge>
          ))}
          {colors.length > 3 && (
            <Badge variant="muted" className="text-[10px]">
              +{colors.length - 3}
            </Badge>
          )}
        </div>
      );
    },
  },
  {
    id: "allowedProperties",
    header: "İzinli Özellikler",
    cell: ({ row }) => {
      const props = row.original.allowedProperties ?? [];
      if (props.length === 0) {
        return <span className="text-xs text-muted-foreground italic">Tümü</span>;
      }
      return (
        <div className="flex flex-wrap gap-1">
          {props.slice(0, 3).map((p) => (
            <Badge key={p.propertyId} variant="muted" className="text-[10px]">
              {p.property.name}
            </Badge>
          ))}
          {props.length > 3 && (
            <Badge variant="muted" className="text-[10px]">
              +{props.length - 3}
            </Badge>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "isActive",
    header: () => <SortableHeader field="isActive" label="Durum" />,
    cell: ({ row }) => (row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
  },
];

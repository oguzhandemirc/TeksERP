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
    accessorKey: "isDerived",
    header: () => <SortableHeader field="isDerived" label="Tip" />,
    cell: ({ row }) =>
      row.original.isDerived ? (
        <Badge>Final Ürün</Badge>
      ) : (
        <Badge variant="muted">Ham Ürün</Badge>
      ),
  },
  {
    accessorKey: "itemType",
    header: () => <SortableHeader field="itemType" label="Sınıf" />,
    cell: ({ row }) => <Badge variant="muted">{itemTypeLabels[row.original.itemType]}</Badge>,
  },
  {
    accessorKey: "unit",
    header: () => <SortableHeader field="unit" label="Birim" />,
  },
  {
    accessorKey: "isActive",
    header: () => <SortableHeader field="isActive" label="Durum" />,
    cell: ({ row }) => (row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
  },
];

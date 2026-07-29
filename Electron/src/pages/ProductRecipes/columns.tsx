import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import type { ProductRecipe } from "./types";

export const recipeColumns: ColumnDef<ProductRecipe>[] = [
  {
    accessorKey: "code",
    header: () => <SortableHeader field="code" label="Kod" />,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
  },
  {
    accessorKey: "name",
    header: () => <SortableHeader field="name" label="Ad" />,
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    id: "item",
    header: "Kumaş",
    cell: ({ row }) =>
      row.original.item?.name ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "color",
    header: "Renk",
    cell: ({ row }) => {
      const c = row.original.color;
      if (!c) return <span className="text-muted-foreground">—</span>;
      return (
        <Badge variant="muted" className="gap-1 text-[10px]">
          {c.hex && (
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: c.hex }}
            />
          )}
          {c.name}
        </Badge>
      );
    },
  },
  {
    id: "route",
    header: "Rota",
    cell: ({ row }) =>
      row.original.route?.name ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "props",
    header: "Özellik",
    cell: ({ row }) => <Badge variant="muted">{row.original.properties?.length ?? 0}</Badge>,
  },
  {
    accessorKey: "isActive",
    header: "Durum",
    cell: ({ row }) =>
      row.original.isActive ? (
        <Badge>Aktif</Badge>
      ) : (
        <Badge variant="muted">Pasif</Badge>
      ),
  },
];

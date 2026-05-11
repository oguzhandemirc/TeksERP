import type { ColumnDef } from "@tanstack/react-table";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { cn } from "@/lib/utils";
import type { ProductionRoute } from "./types";

export const routeColumns: ColumnDef<ProductionRoute>[] = [
  {
    accessorKey: "isFavorite",
    header: "",
    size: 40,
    cell: ({ row }) => (
      <Star
        className={cn(
          "h-3.5 w-3.5",
          row.original.isFavorite ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30",
        )}
      />
    ),
  },
  {
    accessorKey: "code",
    header: () => <SortableHeader field="code" label="Kod" />,
    cell: ({ row }) =>
      row.original.code ? (
        <span className="font-mono text-xs">{row.original.code}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "name",
    header: () => <SortableHeader field="name" label="Ad" />,
  },
  {
    id: "stepCount",
    header: "Adım",
    cell: ({ row }) => <Badge variant="muted">{row.original.steps?.length ?? 0}</Badge>,
  },
  {
    id: "customer",
    header: "Müşteri",
    cell: ({ row }) =>
      row.original.customer ? (
        <span className="text-sm">{row.original.customer.name}</span>
      ) : (
        <span className="text-muted-foreground">— (genel)</span>
      ),
  },
  {
    accessorKey: "isActive",
    header: () => <SortableHeader field="isActive" label="Durum" />,
    cell: ({ row }) =>
      row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>,
  },
];

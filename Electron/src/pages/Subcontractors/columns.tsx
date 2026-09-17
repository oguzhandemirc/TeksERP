import type { ColumnDef } from "@tanstack/react-table";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import type { Subcontractor } from "./types";

export const subcontractorColumns: ColumnDef<Subcontractor>[] = [
  {
    accessorKey: "code",
    header: () => <SortableHeader field="code" label="Kod" />,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
  },
  {
    accessorKey: "name",
    header: () => <SortableHeader field="name" label="Ad" />,
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5">
        {row.original.isFavorite && (
          <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
        )}
        {row.original.name}
      </span>
    ),
  },
  {
    id: "categories",
    header: "Kategoriler",
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.categories.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          row.original.categories.map((c) => (
            <Badge key={c.categoryId} variant="muted" className="text-[10px]">
              {c.category?.name ?? c.categoryId}
            </Badge>
          ))
        )}
      </div>
    ),
  },
  {
    id: "customer",
    header: "Bağlı cari",
    // Fason = carinin rolü: bağlı kart "Ad — KOD"; bağsız fason "—" (bugünkü davranış).
    cell: ({ row }) =>
      row.original.customer ? (
        <span className="text-xs">
          {row.original.customer.name} <span className="font-mono text-muted-foreground">— {row.original.customer.code}</span>
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "phone",
    header: () => <SortableHeader field="phone" label="Telefon" />,
    cell: ({ row }) =>
      row.original.phone ? (
        <span className="font-mono text-xs">{row.original.phone}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "isActive",
    header: () => <SortableHeader field="isActive" label="Durum" />,
    cell: ({ row }) => (row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
  },
];

import type { ColumnDef } from "@tanstack/react-table";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import type { ProductionRoute } from "./types";

export const routeColumns: ColumnDef<ProductionRoute>[] = [
  {
    accessorKey: "isFavorite",
    // Başlıksız sütun "bu yıldız ne?" sorusu bırakıyordu: başlık simgesi + ipucu.
    header: () => (
      <span title="Favori rota" aria-label="Favori">
        <Star className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
    ),
    size: 40,
    cell: ({ row }) =>
      row.original.isFavorite ? (
        <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" aria-label="Favori" />
      ) : null,
  },
  // O25: ad birincil, kod ikinci ve soluk.
  {
    accessorKey: "name",
    header: () => <SortableHeader field="name" label="Ad" />,
  },
  {
    accessorKey: "code",
    header: () => <SortableHeader field="code" label="Kod" />,
    cell: ({ row }) =>
      row.original.code ? (
        <span className="font-mono text-xs text-muted-foreground">{row.original.code}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
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
        <span className="text-muted-foreground">Tüm müşteriler</span>
      ),
  },
  {
    accessorKey: "isActive",
    header: () => <SortableHeader field="isActive" label="Durum" />,
    cell: ({ row }) =>
      row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>,
  },
];

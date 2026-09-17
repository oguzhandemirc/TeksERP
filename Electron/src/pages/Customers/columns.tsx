import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { partnerRoleBadges } from "@/lib/partnerRoles";
import type { Customer } from "./types";

export const customerColumns: ColumnDef<Customer>[] = [
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
    accessorKey: "type",
    header: () => <SortableHeader field="type" label="Rol" />,
    // Rol modeli: bayrak başına rozet (Müşteri · Tedarikçi · Fason); `type` yalnız sıralama anahtarı.
    cell: ({ row }) => (
      <span className="flex flex-wrap items-center gap-1">
        {partnerRoleBadges(row.original).map((label) => (
          <Badge key={label} variant={label === "Müşteri" ? "default" : label === "Tedarikçi" ? "secondary" : "outline"}>
            {label}
          </Badge>
        ))}
      </span>
    ),
  },
  {
    accessorKey: "taxNumber",
    header: () => <SortableHeader field="taxNumber" label="Vergi No" />,
    cell: ({ row }) => row.original.taxNumber ?? <span className="text-muted-foreground">—</span>,
  },
  {
    accessorKey: "isActive",
    header: () => <SortableHeader field="isActive" label="Durum" />,
    cell: ({ row }) => (row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
  },
];

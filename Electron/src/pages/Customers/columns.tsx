import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { companyTypeLabels } from "@/types/enums";
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
    header: () => <SortableHeader field="type" label="Tip" />,
    cell: ({ row }) => (
      <Badge variant={row.original.type === "CUSTOMER" ? "default" : "secondary"}>
        {companyTypeLabels[row.original.type]}
      </Badge>
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

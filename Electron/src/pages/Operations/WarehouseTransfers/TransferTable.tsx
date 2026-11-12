// Depo transferleri tablosu — ortak DataTable sütunları (düzen `warehouse-transfer:list` altında kayıtlı).
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatFactory } from "@/lib/factory-time";
import type { TransferListRow } from "./service";

export const TRANSFER_COLUMNS: ColumnDef<TransferListRow>[] = [
  { accessorKey: "transferNo", header: "Belge No", cell: ({ row }) => <span className="font-mono text-xs">{row.original.transferNo}</span> },
  {
    id: "createdAt",
    header: "Tarih",
    meta: { label: "Tarih", exportValue: (r) => formatFactory(r.createdAt, "dd MMM yyyy HH:mm") },
    cell: ({ row }) => formatFactory(row.original.createdAt, "dd MMM yyyy HH:mm"),
  },
  {
    id: "route",
    header: "Güzergâh",
    size: 280,
    meta: { label: "Güzergâh", exportValue: (r) => `${r.fromWarehouse.name} → ${r.toWarehouse.name}` },
    cell: ({ row: { original: r } }) => (
      <span className="inline-flex items-center gap-1">
        {r.fromWarehouse.name}
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        {r.toWarehouse.name}
      </span>
    ),
  },
  { id: "movements", header: "Top", size: 80, meta: { label: "Top", align: "right", exportValue: (r) => r._count.movements }, cell: ({ row }) => <span className="tabular-nums">{row.original._count.movements}</span> },
  {
    id: "status",
    header: "Durum",
    meta: { label: "Durum", exportValue: (r) => (r.status === "CANCELLED" ? "Geri alındı" : "Tamam") },
    cell: ({ row }) => (row.original.status === "CANCELLED" ? <Badge variant="outline">Geri alındı</Badge> : <Badge>Tamam</Badge>),
  },
];

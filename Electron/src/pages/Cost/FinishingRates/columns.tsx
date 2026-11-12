// Terbiye tarifeleri — tablo sütunları (ortak DataTable).
import type { ColumnDef } from "@tanstack/react-table";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { fmtFactoryDate } from "@/lib/factory-time";
import { fmtDecFull, fmtPct } from "../shared/format";
import { FINISHING_BASIS_LABEL, finishingBasisUnit, type FinishingRate } from "./service";

const priceText = (r: FinishingRate) => `${fmtDecFull(r.pricePerM)} ${r.currency}/${finishingBasisUnit(r.basis)}`;

const BASE: ColumnDef<FinishingRate>[] = [
  {
    id: "code",
    header: "Kod / Ad",
    meta: { label: "Kod / Ad", exportValue: (r) => `${r.code} ${r.name}` },
    accessorFn: (r) => r.code,
    cell: ({ row: { original: r } }) => <span><span className="font-medium">{r.code}</span> <span className="text-muted-foreground">{r.name}</span></span>,
  },
  { id: "subcontractor", header: "Fason firma", meta: { label: "Fason firma" }, accessorFn: (r) => r.subcontractor?.name ?? "—" },
  { id: "basis", header: "Baz", meta: { label: "Baz" }, accessorFn: (r) => FINISHING_BASIS_LABEL[r.basis] },
  { id: "price", header: "Fiyat", meta: { label: "Fiyat", align: "right", exportValue: priceText }, cell: ({ row }) => priceText(row.original) },
  { id: "shrink", header: "Tipik çekme", meta: { label: "Tipik çekme", align: "right", exportValue: (r) => fmtPct(r.typicalShrinkPct) }, cell: ({ row }) => fmtPct(row.original.typicalShrinkPct) },
  { id: "createdAt", header: "Tarih", meta: { label: "Tarih", exportValue: (r) => fmtFactoryDate(r.createdAt) }, accessorFn: (r) => r.createdAt, cell: ({ row }) => fmtFactoryDate(row.original.createdAt) },
];

export function finishingColumns(onEdit: (e: { row: FinishingRate }) => void, onHistory: (r: FinishingRate) => void): ColumnDef<FinishingRate>[] {
  return [
    ...BASE,
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      meta: { label: "İşlem", align: "right" },
      cell: ({ row: { original: r } }) => (
        <span className="whitespace-nowrap">
          <PermissionGate permission="cost:write">
            <Button size="sm" variant="outline" className="h-7" onClick={() => onEdit({ row: r })}>Fiyat değiştir</Button>
          </PermissionGate>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => onHistory(r)} aria-label="Geçmiş"><History className="h-4 w-4" /></Button>
        </span>
      ),
    },
  ];
}

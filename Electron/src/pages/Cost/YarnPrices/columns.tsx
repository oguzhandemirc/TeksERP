// İplik maliyet fiyatları — tablo sütunları (ortak DataTable). 90 günden eski fiyat sarı yaş hücresiyle uyarır.
import type { ColumnDef } from "@tanstack/react-table";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { fmtFactoryDate } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { STALE_DAYS, ageDays, fmtDecFull, fmtQtyDecFull } from "../shared/format";
import { YARN_PRICE_SOURCE_LABEL, type YarnCostPrice } from "./service";

const right = (label: string) => ({ label, align: "right" as const });

const BASE: ColumnDef<YarnCostPrice>[] = [
  {
    id: "yarn",
    header: "İplik",
    meta: { label: "İplik", exportValue: (r) => `${r.yarnItem.code} ${r.yarnItem.name}` },
    accessorFn: (r) => r.yarnItem.code,
    cell: ({ row: { original: r } }) => <span><span className="font-medium">{r.yarnItem.code}</span> <span className="text-muted-foreground">{r.yarnItem.name}</span></span>,
  },
  { id: "den", header: "Denye", meta: { ...right("Denye"), exportValue: (r) => fmtQtyDecFull(r.yarnItem.linearDensityDen, 2) }, cell: ({ row }) => fmtQtyDecFull(row.original.yarnItem.linearDensityDen, 2) },
  { id: "price", header: "Fiyat", meta: { ...right("Fiyat"), exportValue: (r) => `${fmtDecFull(r.pricePerKg)} ${r.currency}/kg` }, cell: ({ row: { original: r } }) => `${fmtDecFull(r.pricePerKg)} ${r.currency}/kg` },
  { id: "source", header: "Kaynak", meta: { label: "Kaynak" }, accessorFn: (r) => YARN_PRICE_SOURCE_LABEL[r.source] ?? r.source },
  { id: "createdAt", header: "Tarih", meta: { label: "Tarih", exportValue: (r) => fmtFactoryDate(r.createdAt) }, accessorFn: (r) => r.createdAt, cell: ({ row }) => fmtFactoryDate(row.original.createdAt) },
  {
    id: "age",
    header: "Yaş",
    meta: { ...right("Yaş"), exportValue: (r) => `${ageDays(r.createdAt)} gün` },
    accessorFn: (r) => ageDays(r.createdAt),
    cell: ({ row: { original: r } }) => {
      const age = ageDays(r.createdAt);
      const stale = age > STALE_DAYS;
      return (
        <span className={cn(stale && "font-medium text-amber-600 dark:text-amber-400")} title={stale ? "90 günden eski — maliyette PRICE_STALE uyarısı" : undefined}>
          {age} gün
        </span>
      );
    },
  },
];

export function yarnPriceColumns(onEdit: (e: { row: YarnCostPrice }) => void, onHistory: (r: YarnCostPrice) => void): ColumnDef<YarnCostPrice>[] {
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

// Hizmet sarf normları — tablo sütunları (ortak DataTable).
import type { ColumnDef } from "@tanstack/react-table";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { fmtFactoryDate } from "@/lib/factory-time";
import { fmtDecFull } from "../shared/format";
import type { ConsumableNorm } from "./service";

const qtyText = (r: ConsumableNorm) =>
  /^0(\.0+)?$/.test(String(r.qtyPerM)) ? "0 — sarf kullanmaz" : `${fmtDecFull(r.qtyPerM, 6)} ${r.unit}/${r.basis === "PER_ROLL" ? "top" : "m"}`;
const codeName = (it: { code: string; name: string }) => (
  <span><span className="font-medium">{it.code}</span> <span className="text-muted-foreground">{it.name}</span></span>
);

const BASE: ColumnDef<ConsumableNorm>[] = [
  { id: "service", header: "Hizmet", meta: { label: "Hizmet", exportValue: (r) => `${r.serviceItem.code} ${r.serviceItem.name}` }, accessorFn: (r) => r.serviceItem.code, cell: ({ row }) => codeName(row.original.serviceItem) },
  { id: "consumable", header: "Sarf", meta: { label: "Sarf", exportValue: (r) => `${r.consumableItem.code} ${r.consumableItem.name}` }, accessorFn: (r) => r.consumableItem.code, cell: ({ row }) => codeName(row.original.consumableItem) },
  {
    id: "qty",
    header: "Miktar",
    meta: { label: "Miktar", align: "right", exportValue: (r) => [qtyText(r), r.propertyValue?.name].filter(Boolean).join(" · ") },
    cell: ({ row: { original: r } }) => (
      <span className="tabular-nums">
        {qtyText(r)}
        {r.propertyValue && <span className="ml-1 rounded-badge bg-muted px-1.5 py-0.5 text-xs">{r.propertyValue.name}</span>}
      </span>
    ),
  },
  { id: "createdAt", header: "Geçerli olduğu an", meta: { label: "Geçerli olduğu an", exportValue: (r) => fmtFactoryDate(r.createdAt) }, accessorFn: (r) => r.createdAt, cell: ({ row }) => fmtFactoryDate(row.original.createdAt) },
];

export function normColumns(onEdit: (r: { current: ConsumableNorm }) => void, onHistory: (r: ConsumableNorm) => void): ColumnDef<ConsumableNorm>[] {
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
            <Button size="sm" variant="outline" className="h-7" onClick={() => onEdit({ current: r })}>Normu değiştir</Button>
          </PermissionGate>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => onHistory(r)} aria-label="Geçmiş"><History className="h-4 w-4" /></Button>
        </span>
      ),
    },
  ];
}

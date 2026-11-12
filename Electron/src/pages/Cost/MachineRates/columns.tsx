// Makine saat ücretleri — tablo sütunları (ortak DataTable). Ücretsiz makine satırı "ücret yok" ile uyarır.
import type { ColumnDef } from "@tanstack/react-table";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { fmtFactoryDate } from "@/lib/factory-time";
import { fmtDecFull } from "../shared/format";
import type { MachineCostRate } from "./service";
import type { MachineRateRow } from "./MachineRatesPage";

const right = (label: string) => ({ label, align: "right" as const });

const BASE: ColumnDef<MachineRateRow>[] = [
  {
    id: "machine",
    header: "Makine",
    meta: { label: "Makine", exportValue: (r) => `${r.machine.code} ${r.machine.name}` },
    accessorFn: (r) => r.machine.code,
    cell: ({ row: { original: r } }) => <span><span className="font-medium">{r.machine.code}</span> <span className="text-muted-foreground">{r.machine.name}</span></span>,
  },
  {
    id: "hourRate",
    header: "Saat ücreti",
    meta: { ...right("Saat ücreti"), exportValue: (r) => (r.rate ? `${fmtDecFull(r.rate.hourRateTry)} TL` : "ücret yok") },
    cell: ({ row: { original: r } }) => (r.rate ? `${fmtDecFull(r.rate.hourRateTry)} TL` : <span className="text-amber-600 dark:text-amber-400">ücret yok</span>),
  },
  { id: "normM", header: "Beklenen m/saat", meta: { ...right("Beklenen m/saat"), exportValue: (r) => (r.rate ? fmtDecFull(r.rate.normMPerHour, 2) : "—") }, cell: ({ row: { original: r } }) => (r.rate ? fmtDecFull(r.rate.normMPerHour, 2) : "—") },
  { id: "createdAt", header: "Geçerli olduğu an", meta: { label: "Geçerli olduğu an", exportValue: (r) => (r.rate ? fmtFactoryDate(r.rate.createdAt) : "—") }, accessorFn: (r) => r.rate?.createdAt ?? null, cell: ({ row: { original: r } }) => (r.rate ? fmtFactoryDate(r.rate.createdAt) : "—") },
];

export function machineRateColumns(
  onEdit: (e: { current: MachineCostRate | null; machine: MachineRateRow["machine"] }) => void,
  onHistory: (r: MachineCostRate) => void,
): ColumnDef<MachineRateRow>[] {
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
            <Button size="sm" variant="outline" className="h-7" onClick={() => onEdit({ current: r.rate, machine: r.machine })}>{r.rate ? "Ücreti değiştir" : "Ücret gir"}</Button>
          </PermissionGate>
          {r.rate && <Button size="sm" variant="ghost" className="h-7" onClick={() => r.rate && onHistory(r.rate)} aria-label="Geçmiş"><History className="h-4 w-4" /></Button>}
        </span>
      ),
    },
  ];
}

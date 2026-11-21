// Ek maliyet formülleri — tablo sütunları (ortak DataTable).
import type { ColumnDef } from "@tanstack/react-table";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { fmtFactoryDate } from "@/lib/factory-time";
import type { CostFormula } from "./service";

const BASE: ColumnDef<CostFormula>[] = [
  {
    id: "name",
    header: "Ad / Kod",
    meta: { label: "Ad / Kod", exportValue: (r) => `${r.name} ${r.code}` },
    accessorFn: (r) => r.name,
    cell: ({ row: { original: r } }) => <span><span className="font-medium">{r.name}</span> <span className="text-muted-foreground">{r.code}</span></span>,
  },
  { id: "expression", header: "İfade", meta: { label: "İfade" }, accessorFn: (r) => r.expression, cell: ({ row }) => <code className="font-mono text-xs">{row.original.expression}</code> },
  { id: "currency", header: "Birim", meta: { label: "Birim" }, accessorFn: (r) => `${r.currency}/m` },
  { id: "sortOrder", header: "Sıra", meta: { label: "Sıra", align: "right" }, accessorFn: (r) => r.sortOrder },
  { id: "version", header: "Sürüm", meta: { label: "Sürüm", align: "right" }, accessorFn: (r) => r.versionNo },
  { id: "createdAt", header: "Tarih", meta: { label: "Tarih", exportValue: (r) => fmtFactoryDate(r.createdAt) }, accessorFn: (r) => r.createdAt, cell: ({ row }) => fmtFactoryDate(row.original.createdAt) },
];

interface Actions { onEdit: (r: CostFormula) => void; onHistory: (r: CostFormula) => void }

/** Kaldırma geçmiş panelinde (onaylı); satırda yalnız değiştir + geçmiş. */
export function formulaColumns({ onEdit, onHistory }: Actions): ColumnDef<CostFormula>[] {
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
          <PermissionGate permission="cost:settings">
            <Button size="sm" variant="outline" className="h-7" onClick={() => onEdit(r)}>Değiştir</Button>
          </PermissionGate>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => onHistory(r)} aria-label="Geçmiş"><History className="h-4 w-4" /></Button>
        </span>
      ),
    },
  ];
}

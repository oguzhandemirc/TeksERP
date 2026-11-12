// Test türü kataloğu — tablo sütunları (ortak DataTable). Eylem sütunu yalnız yazma izninde.
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LabTestType } from "./service";
import { KIND_LABEL, specRangeText } from "./labTestRules";

const kindText = (t: LabTestType) => `${KIND_LABEL[t.resultKind]}${t.unit ? ` · ${t.unit}` : ""}`;
const rangeText = (t: LabTestType) => specRangeText(t.specMin, t.specMax, t.resultKind) ?? "—";

const BASE: ColumnDef<LabTestType>[] = [
  { id: "code", header: "Kod", meta: { label: "Kod" }, accessorFn: (t) => t.code, cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span> },
  { id: "name", header: "Ad", size: 200, meta: { label: "Ad" }, accessorFn: (t) => t.name },
  { id: "method", header: "Yöntem", meta: { label: "Yöntem" }, accessorFn: (t) => t.method ?? "—", cell: ({ row }) => <span className="text-muted-foreground">{row.original.method ?? "—"}</span> },
  { id: "kind", header: "Biçim", meta: { label: "Biçim" }, accessorFn: kindText },
  { id: "range", header: "Varsayılan sınır", meta: { label: "Varsayılan sınır" }, accessorFn: rangeText, cell: ({ row }) => <span className="tabular-nums">{rangeText(row.original)}</span> },
  {
    id: "active",
    header: "Durum",
    meta: { label: "Durum", exportValue: (t) => (t.isActive ? "Etkin" : "Pasif") },
    accessorFn: (t) => t.isActive,
    cell: ({ row }) => (row.original.isActive ? <Badge variant="outline">Etkin</Badge> : <Badge variant="muted">Pasif</Badge>),
  },
];

export function labTypeColumns(canWrite: boolean, busy: boolean, onEdit: (t: LabTestType) => void, onToggle: (t: LabTestType) => void): ColumnDef<LabTestType>[] {
  if (!canWrite) return BASE;
  return [
    ...BASE,
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      meta: { label: "İşlem", align: "right" },
      cell: ({ row: { original: t } }) => (
        <span className="whitespace-nowrap">
          <Button size="sm" variant="ghost" className="h-7" onClick={() => onEdit(t)}>Düzenle</Button>
          <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => onToggle(t)}>{t.isActive ? "Pasife al" : "Etkinleştir"}</Button>
        </span>
      ),
    },
  ];
}

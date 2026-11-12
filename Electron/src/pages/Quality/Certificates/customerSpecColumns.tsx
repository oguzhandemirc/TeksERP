// Müşteri lab spesifikasyonları — tablo sütunları (ortak DataTable).
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import type { CustomerLabSpec } from "./service";

const num = (v: string | number | null) => (v === null || v === "" ? "—" : String(v).replace(".", ","));
const bound = (r: CustomerLabSpec, v: string | number | null) => `${num(v)}${r.testType.unit && v !== null ? ` ${r.testType.unit}` : ""}`;
const right = (label: string) => ({ label, align: "right" as const });

export const CUSTOMER_SPEC_COLUMNS: ColumnDef<CustomerLabSpec>[] = [
  { id: "customer", header: "Müşteri", meta: { label: "Müşteri" }, accessorFn: (r) => r.customer.name },
  {
    id: "item",
    header: "Ürün",
    meta: { label: "Ürün", exportValue: (r) => r.item?.name ?? "Tüm ürünler" },
    accessorFn: (r) => r.item?.name ?? "Tüm ürünler",
    cell: ({ row: { original: r } }) => (r.item ? r.item.name : <span className="text-muted-foreground">Tüm ürünler</span>),
  },
  { id: "testType", header: "Test türü", meta: { label: "Test türü" }, accessorFn: (r) => r.testType.name },
  { id: "min", header: "Alt sınır", meta: { ...right("Alt sınır"), exportValue: (r) => bound(r, r.specMin) }, cell: ({ row }) => bound(row.original, row.original.specMin) },
  { id: "max", header: "Üst sınır", meta: { ...right("Üst sınır"), exportValue: (r) => bound(r, r.specMax) }, cell: ({ row }) => bound(row.original, row.original.specMax) },
  {
    id: "active",
    header: "Durum",
    meta: { label: "Durum", exportValue: (r) => (r.isActive ? "Etkin" : "Pasif") },
    accessorFn: (r) => r.isActive,
    cell: ({ row }) => (row.original.isActive ? <Badge variant="outline">Etkin</Badge> : <Badge variant="secondary">Pasif</Badge>),
  },
];

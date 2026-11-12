// Fiyat listeleri — tablo sütunları (ortak DataTable).
import type { ColumnDef } from "@tanstack/react-table";
import { formatCalendarDay } from "@/lib/factory-time";
import { PriceListStatusBadge } from "./PriceListStatusBadge";
import { priceListLabel, type PriceListRow } from "./pl-types";

const validityText = (r: PriceListRow) =>
  r.validFromDate || r.validUntilDate
    ? `${r.validFromDate ? formatCalendarDay(r.validFromDate) : "…"} – ${r.validUntilDate ? formatCalendarDay(r.validUntilDate) : "…"}`
    : "—";

export const PRICE_LIST_COLUMNS: ColumnDef<PriceListRow>[] = [
  { id: "number", header: "Liste no", meta: { label: "Liste no", exportValue: priceListLabel }, accessorFn: priceListLabel, cell: ({ row }) => <span className="font-mono text-xs">{priceListLabel(row.original)}</span> },
  { id: "name", header: "Ad", size: 220, meta: { label: "Ad" }, accessorFn: (r) => r.name },
  {
    id: "scope",
    header: "Kapsam",
    meta: { label: "Kapsam", exportValue: (r) => r.customer?.name ?? "Genel" },
    accessorFn: (r) => r.customer?.name ?? "Genel",
    cell: ({ row: { original: r } }) => (r.customer ? r.customer.name : <span className="text-muted-foreground">Genel</span>),
  },
  { id: "currency", header: "Döviz", meta: { label: "Döviz" }, accessorFn: (r) => r.currency },
  { id: "validity", header: "Geçerlilik", meta: { label: "Geçerlilik" }, accessorFn: validityText, cell: ({ row }) => <span className="text-xs">{validityText(row.original)}</span> },
  { id: "lines", header: "Satır", meta: { label: "Satır", align: "right" }, accessorFn: (r) => r._count.lines },
  { id: "status", header: "Durum", meta: { label: "Durum" }, accessorFn: (r) => r.status, cell: ({ row }) => <PriceListStatusBadge status={row.original.status} /> },
];

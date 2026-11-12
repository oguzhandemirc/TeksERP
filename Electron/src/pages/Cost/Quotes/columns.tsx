// Teklifler — tablo sütunları (ortak DataTable).
import type { ColumnDef } from "@tanstack/react-table";
import { formatCalendarDay } from "@/lib/factory-time";
import { fmtDec } from "../shared/format";
import { quoteNumberLabel } from "./labels";
import { QuoteStatusBadge } from "./QuoteStatusBadge";
import type { QuoteRow } from "./quote-types";

const amountText = (r: QuoteRow) => `${fmtDec(r.totalAmount)} ${r.currency}`;

export const QUOTE_COLUMNS: ColumnDef<QuoteRow>[] = [
  { id: "number", header: "Teklif no", meta: { label: "Teklif no", exportValue: quoteNumberLabel }, accessorFn: quoteNumberLabel, cell: ({ row }) => <span className="font-mono text-xs">{quoteNumberLabel(row.original)}</span> },
  { id: "customer", header: "Müşteri", size: 220, meta: { label: "Müşteri" }, accessorFn: (r) => r.customer.name },
  { id: "quoteDate", header: "Tarih", meta: { label: "Tarih", exportValue: (r) => formatCalendarDay(r.quoteDate) }, accessorFn: (r) => r.quoteDate, cell: ({ row }) => formatCalendarDay(row.original.quoteDate) },
  { id: "validUntil", header: "Geçerlilik", meta: { label: "Geçerlilik", exportValue: (r) => formatCalendarDay(r.validUntilDate) }, accessorFn: (r) => r.validUntilDate, cell: ({ row }) => formatCalendarDay(row.original.validUntilDate) },
  { id: "lines", header: "Kalem", meta: { label: "Kalem", align: "right" }, accessorFn: (r) => r._count.lines },
  { id: "amount", header: "Tutar", meta: { label: "Tutar", align: "right", exportValue: amountText }, cell: ({ row }) => amountText(row.original) },
  { id: "status", header: "Durum", meta: { label: "Durum" }, accessorFn: (r) => r.status, cell: ({ row: { original: r } }) => <QuoteStatusBadge status={r.status} expired={r.suresiDoldu} /> },
  { id: "order", header: "Sipariş", meta: { label: "Sipariş" }, accessorFn: (r) => r.convertedOrder?.orderNumber ?? "—", cell: ({ row }) => <span className="text-xs">{row.original.convertedOrder?.orderNumber ?? "—"}</span> },
];

// Gönderilmiş/kapanmış teklifin başlığı (salt okunur). Sayılar sunucu metninden biçimlenir.
import type { ReactNode } from "react";
import { formatCalendarDay } from "@/lib/factory-time";
import { decToInput, fmtDecFull, fmtPct } from "../shared/format";
import type { QuoteDetail } from "./quote-types";

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function QuoteHeaderSummary({ q }: { q: QuoteDetail }) {
  return (
    <dl className="grid gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-4">
      <Item label="Müşteri">{q.customer.name}{q.branch ? ` · ${q.branch.name}` : ""}</Item>
      <Item label="Tarih / geçerlilik">{formatCalendarDay(q.quoteDate)} → {formatCalendarDay(q.validUntilDate)}</Item>
      <Item label="Döviz / kur">{q.currency}{q.currency !== "TRY" ? ` · ${fmtDecFull(q.fxRate, 6)} TL` : ""}</Item>
      <Item label="Vade">{q.paymentTermDays === null ? "—" : `${q.paymentTermDays} gün`}{q.financeChargePct ? ` · vade farkı ${fmtPct(q.financeChargePct)}` : ""}</Item>
      <Item label="Komisyon">{fmtPct(q.commissionPct)}</Item>
      <Item label="Navlun">{q.freightPerM ? `${decToInput(q.freightPerM)} ${q.currency}/m` : "—"}</Item>
      <Item label="Müşteri referansı">{q.customerReference ?? "—"}</Item>
      <Item label="Not">{q.notes ?? "—"}</Item>
      {q.internalNote !== undefined && <Item label="İç not">{q.internalNote ?? "—"}</Item>}
    </dl>
  );
}

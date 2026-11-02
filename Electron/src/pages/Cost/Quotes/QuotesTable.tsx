import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCalendarDay } from "@/lib/factory-time";
import { fmtDec } from "../shared/format";
import { quoteNumberLabel } from "./labels";
import { QuoteStatusBadge } from "./QuoteStatusBadge";
import type { QuoteRow } from "./quote-types";

export function QuotesTable({ rows, onOpen }: { rows: QuoteRow[]; onOpen: (id: string) => void }) {
  return (
    <Table containerClassName="overflow-visible">
      <TableHeader>
        <TableRow>
          <TableHead>Teklif no</TableHead>
          <TableHead>Müşteri</TableHead>
          <TableHead>Tarih</TableHead>
          <TableHead>Geçerlilik</TableHead>
          <TableHead className="text-right">Kalem</TableHead>
          <TableHead className="text-right">Tutar</TableHead>
          <TableHead>Durum</TableHead>
          <TableHead>Sipariş</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r.id)} data-testid="quote-row">
            <TableCell className="whitespace-nowrap font-mono text-xs">{quoteNumberLabel(r)}</TableCell>
            <TableCell className="min-w-40">{r.customer.name}</TableCell>
            <TableCell className="whitespace-nowrap">{formatCalendarDay(r.quoteDate)}</TableCell>
            <TableCell className="whitespace-nowrap">{formatCalendarDay(r.validUntilDate)}</TableCell>
            <TableCell className="text-right tabular-nums">{r._count.lines}</TableCell>
            <TableCell className="whitespace-nowrap text-right tabular-nums">{fmtDec(r.totalAmount)} {r.currency}</TableCell>
            <TableCell><QuoteStatusBadge status={r.status} expired={r.suresiDoldu} /></TableCell>
            <TableCell className="whitespace-nowrap text-xs">{r.convertedOrder?.orderNumber ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

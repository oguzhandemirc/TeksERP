// Ekstre tablosu — kolonlar ve satırlar dosya spec'iyle AYNI kuruculardan (`statementExport.ts`); hücre metni
// `reportCellText` (PDF'in hane kuralı). Ekran, dosyanın gösterdiğinden başka bir sayı göstermez.
import type { ReportColumn } from "@/pages/Reports/_components/reportExport";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { reportCellText } from "@/lib/number-format";
import { cn } from "@/lib/utils";

interface Props {
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  totalRow?: Record<string, unknown>;
  /** Satır vurgusu (ör. storno) — satır nesnesinden. */
  rowClassName?: (row: Record<string, unknown>) => string | undefined;
  testId?: string;
}

const cellText = (c: ReportColumn, v: unknown) => (c.numFmt ? reportCellText(v, c.numFmt) : String(v ?? ""));

export function StatementTable({ columns, rows, totalRow, rowClassName, testId }: Props) {
  return (
    <Table data-testid={testId}>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.key} className={cn("whitespace-nowrap", c.align === "right" && "text-right")}>
              {c.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i} className={rowClassName?.(r)}>
            {columns.map((c) => (
              <TableCell key={c.key} className={cn("whitespace-nowrap", c.align === "right" && "text-right tabular-nums")}>
                {cellText(c, r[c.key])}
              </TableCell>
            ))}
          </TableRow>
        ))}
        {totalRow && (
          <TableRow className="bg-muted/50 font-semibold">
            {columns.map((c) => (
              <TableCell key={c.key} className={cn("whitespace-nowrap", c.align === "right" && "text-right tabular-nums")}>
                {cellText(c, totalRow[c.key])}
              </TableCell>
            ))}
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

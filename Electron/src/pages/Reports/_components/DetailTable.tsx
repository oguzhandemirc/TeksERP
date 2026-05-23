import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Props<T> {
  title?: string;
  description?: string;
  data: T[];
  columns: ColumnDef<T, unknown>[];
  isLoading?: boolean;
  emptyLabel?: string;
  /** Tablo max yüksekliği (px). Aşan içerik scroll. */
  maxHeight?: number;
}

/**
 * Rapor detay tablosu — TanStack basit kullanım, virtualization yok
 * (rapor cevapları zaten sayfa başına 100-500 satırla sınırlı).
 */
export function DetailTable<T>({
  title,
  description,
  data,
  columns,
  isLoading,
  emptyLabel = "Bu aralıkta veri yok",
  maxHeight = 480,
}: Props<T>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <Card className="overflow-hidden">
      {title || description ? (
        <div className="border-b px-4 py-3">
          {title ? <h3 className="text-sm font-semibold tracking-tight">{title}</h3> : null}
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
      ) : null}
      <div className="overflow-auto" style={{ maxHeight }}>
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id} className="text-xs">
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-xs text-muted-foreground/60">
                  Yükleniyor...
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-xs text-muted-foreground/60">
                  {emptyLabel}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((c) => (
                    <TableCell key={c.id} className="text-xs">
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

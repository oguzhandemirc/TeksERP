import { flexRender, type Table as TanstackTable } from "@tanstack/react-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTablePagination } from "./DataTablePagination";
import type { DataTablePagination as Pagination } from "@/hooks/useDataTable";

interface Props<T> {
  table: TanstackTable<T>;
  isLoading?: boolean;
  pagination?: Pagination;
  emptyText?: string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({ table, isLoading, pagination, emptyText = "Kayıt yok.", onRowClick }: Props<T>) {
  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id} style={{ width: h.getSize() === 150 ? undefined : h.getSize() }}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading && rows.length === 0
              ? Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    {table.getAllColumns().map((c) => (
                      <TableCell key={c.id}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : rows.length === 0
                ? (
                    <TableRow>
                      <TableCell
                        colSpan={table.getAllColumns().length}
                        className="h-24 text-center text-muted-foreground"
                      >
                        {emptyText}
                      </TableCell>
                    </TableRow>
                  )
                : rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className={onRowClick ? "cursor-pointer" : undefined}
                      onClick={() => onRowClick?.(row.original)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
          </TableBody>
        </Table>
      </div>
      {pagination ? <DataTablePagination pagination={pagination} /> : null}
    </div>
  );
}

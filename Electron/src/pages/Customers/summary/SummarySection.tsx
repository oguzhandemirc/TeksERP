import type { ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useTabsStore } from "@/store/tabs";

interface QueryState {
  isLoading: boolean;
  isError: boolean;
  refetch: () => unknown;
}

interface Props {
  title: string;
  /** Başlığın yanındaki ek bilgi ("son 10" gibi). */
  note?: string;
  query: QueryState;
  empty: boolean;
  /** "Tümünü gör" hedefi — yoksa bağlantı çizilmez (route izni yok). */
  seeAllPath?: string;
  children: ReactNode;
}

/**
 * Özet sekmesinin bölüm kabuğu: iskelet · boş · hata + yeniden dene, bölüm bazında
 * YALITILMIŞ (bir bölümün hatası diğerlerini düşürmez). "Tümünü gör" yeni sekmede açar:
 * cari kartı diyaloğu ve altındaki liste kaybolmasın.
 */
export function SummarySection({ title, note, query, empty, seeAllPath, children }: Props) {
  const openTab = useTabsStore((s) => s.openTab);
  return (
    <section className="space-y-1" aria-label={title}>
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
        {seeAllPath && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="ml-auto h-6 px-0 text-xs"
            onClick={() => openTab(seeAllPath, { forceNew: true })}
          >
            Tümünü gör
          </Button>
        )}
      </div>
      {query.isLoading ? (
        <div className="space-y-1" data-testid="summary-skeleton">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      ) : query.isError ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 px-2 py-1.5 text-xs text-destructive">
          <span>Yüklenemedi.</span>
          <Button type="button" variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => void query.refetch()}>
            <RotateCw className="h-3 w-3" /> Yeniden dene
          </Button>
        </div>
      ) : empty ? (
        <p className="rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground">Kayıt yok</p>
      ) : (
        children
      )}
    </section>
  );
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: "right";
  className?: string;
}

/** Sıkı, tek satırlık, tam genişlik tablo. */
export function SummaryTable<T>({ rows, columns, rowKey }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string }) {
  return (
    <Table className="text-xs" containerClassName="rounded-md border">
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.header} className={cn("h-7 whitespace-nowrap px-2", c.align === "right" && "text-right")}>
              {c.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={rowKey(r)}>
            {columns.map((c) => (
              <TableCell
                key={c.header}
                className={cn("whitespace-nowrap px-2 py-1", c.align === "right" && "text-right tabular-nums", c.className)}
              >
                {c.cell(r)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

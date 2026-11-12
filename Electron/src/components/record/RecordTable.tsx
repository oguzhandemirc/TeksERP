// Kayıt kalıbı — sekme içi sıkı tablo (bölüm kartı içinde gömülü; sayfanın ana listesi değil).
// Hücreler tek satır (kullanıcı kararı: sıkı liste). Satırın hedefi varsa satır tıklanır ve klavyeyle (Enter) açılır; hedefsiz satır düz kalır.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface RecordColumn<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  className?: string;
  /** Hücre TEK SATIR; taşan metin "…" ile kesilir — tam metin `title` ile görünür. */
  title?: (row: T) => string | null | undefined;
  render: (row: T) => ReactNode;
}

interface Props<T> {
  columns: RecordColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: ((row: T) => void) | null;
  rowMuted?: (row: T) => boolean;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  emptyText: string;
}

export function RecordTable<T>({ columns, rows, rowKey, onRowClick, rowMuted, loading, error, onRetry, emptyText }: Props<T>) {
  if (loading) return <div className="space-y-2 px-5 pb-3">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton-shimmer h-8 rounded-lg bg-muted" />)}</div>;
  if (error) {
    return (
      <div className="px-5 py-6 text-center text-sm">
        <p className="font-medium text-destructive">Veri alınamadı.</p>
        {onRetry && <button type="button" onClick={onRetry} className="mt-1 text-xs font-medium text-primary hover:underline">Tekrar dene</button>}
      </div>
    );
  }
  if (rows.length === 0) return <p className="px-5 py-8 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/70">
            {columns.map((c) => (
              <th key={c.key} className={cn("whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground first:pl-5 last:pr-5", c.align === "right" ? "text-right" : "text-left")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => e.key === "Enter" && onRowClick(r) : undefined}
              className={cn("border-b border-border/50 last:border-0", onRowClick && "cursor-pointer transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:outline-none", rowMuted?.(r) && "opacity-60")}
            >
              {columns.map((c) => (
                <td key={c.key} title={c.title?.(r) ?? undefined} className={cn("whitespace-nowrap px-3 py-2 first:pl-5 last:pr-5", c.align === "right" && "text-right tabular-nums", c.className)}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

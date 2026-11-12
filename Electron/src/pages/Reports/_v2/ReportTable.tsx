import { useState, type KeyboardEvent } from "react";
import { Columns3, TableProperties } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ReportColumn } from "@/pages/Reports/_components/reportExport";
import { formatDisplay } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TabloBlok, TabloHucresi, TabloKolonu } from "./sunum";
import { cellText, columnAlign, columnHeader, columnFormat, truncationNote } from "./table-model";
import { barWidth, columnMax, toggleHidden, TOTAL_ON_TOP_AFTER, visibleColumns } from "./view/table-view";

/** Satırdan geçiş (D4-KUC2 e): hedefi olan satır tıklanır/Enter ile açılır; hedefsiz satır düz kalır. */
export interface ReportRowLink {
  target: (row: Record<string, TabloHucresi>) => string | null;
  open: (to: string) => void;
  title: string;
}

interface Props {
  table: TabloBlok;
  rowLink?: ReportRowLink;
  /** Gizli kolonlar (rapor tercihi); verilmezse seçim yalnız bu ekranda yaşar. */
  hiddenColumns?: string[];
  onHiddenColumns?: (keys: string[]) => void;
  /** Görsel büyüklük çubuğu çizilecek kolon (`barColumnOf`); sayı basmaz. */
  barColumn?: string | null;
  /** Başka kartın içine gömülü (analiz kartı, özel rapor bloğu): kart kabuğu ve başlık çizilmez. */
  embedded?: boolean;
}

interface Col {
  c: TabloKolonu;
  fmt: Pick<ReportColumn, "numFmt">;
  right: boolean;
}

const CELL = "whitespace-nowrap px-3";
const NUM = "text-right tabular-nums";

function TotalRow({ cols, total, sticky }: { cols: Col[]; total: Record<string, TabloHucresi>; sticky: boolean }) {
  return (
    <tr className={cn("font-semibold", sticky && "border-b bg-primary/5 text-foreground")} data-testid="report-table-total">
      {cols.map(({ c, fmt, right }) => (
        <td key={c.anahtar} className={cn(CELL, "py-2", right && NUM)}>
          {total[c.anahtar] === undefined ? "" : cellText(total[c.anahtar], fmt)}
        </td>
      ))}
    </tr>
  );
}

function BodyRow({ row, cols, rowLink, barColumn, max }: { row: Record<string, TabloHucresi>; cols: Col[]; rowLink?: ReportRowLink; barColumn?: string | null; max: number }) {
  const to = rowLink?.target(row) ?? null;
  const linkProps = to
    ? {
        role: "link" as const,
        tabIndex: 0,
        title: rowLink!.title,
        onClick: () => rowLink!.open(to),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === "Enter") rowLink!.open(to);
        },
      }
    : {};
  return (
    <tr className={cn("border-t transition-colors hover:bg-muted/40", to && "cursor-pointer hover:bg-primary/5")} {...linkProps}>
      {cols.map(({ c, fmt, right }) => {
        const text = cellText(row[c.anahtar], fmt);
        const w = c.anahtar === barColumn ? barWidth(row[c.anahtar], max) : null;
        return (
          <td key={c.anahtar} className={cn(CELL, "max-w-[22rem] truncate py-1.5", right && NUM)} title={right ? undefined : text}>
            {w === null ? (
              text
            ) : (
              <span className="inline-flex items-center justify-end gap-2">
                <span aria-hidden className="h-1.5 w-14 overflow-hidden rounded-full bg-muted" data-testid="share-bar">
                  <span className="block h-full rounded-full bg-primary/70" style={{ width: `${w}%` }} />
                </span>
                {text}
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function ColumnMenu({ table, hidden, onChange, shown }: { table: TabloBlok; hidden: string[]; onChange: (keys: string[]) => void; shown: number }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground" aria-label="Kolonlar">
          <Columns3 className="h-4 w-4" /> Kolonlar{hidden.length > 0 ? ` (${table.kolonlar.length - shown} gizli)` : ""}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Görünen kolonlar</DropdownMenuLabel>
        {table.kolonlar.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.anahtar}
            checked={!hidden.includes(c.anahtar)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onChange(toggleHidden(table, hidden, c.anahtar))}
          >
            {columnHeader(c)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Sunucunun tablo bloğu; hücre metni PDF/Excel ile aynı biçimden. Ekranda: tek satır hücre, sağa hizalı
 * tabular sayı, yapışkan başlık, kolon aç/kapa, uzun tabloda toplam üstte, görsel büyüklük çubuğu.
 */
export function ReportTable({ table, rowLink, hiddenColumns, onHiddenColumns, barColumn, embedded = false }: Props) {
  const [localHidden, setLocalHidden] = useState<string[]>([]);
  const hidden = hiddenColumns ?? localHidden;
  const cols: Col[] = visibleColumns(table, hidden).map((c) => ({ c, fmt: columnFormat(table, c), right: columnAlign(table, c) === "right" }));
  const note = truncationNote(table);
  const totalOnTop = Boolean(table.toplam) && table.satirlar.length > TOTAL_ON_TOP_AFTER;
  const max = barColumn ? columnMax(table, barColumn) : 0;
  if (table.satirlar.length === 0) {
    return <p className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground">Tabloda gösterilecek satır yok.</p>;
  }
  return (
    <section className={cn("min-w-0 overflow-hidden rounded-xl border bg-card", !embedded && "border-card-border shadow-card")} aria-label="Tablo">
      {embedded ? null : (
        <header className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <TableProperties className="h-4 w-4 text-primary" aria-hidden />
            Ayrıntı
            <span className="rounded-badge bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">{formatDisplay(table.satirlar.length, 0)}</span>
          </h2>
          {table.kolonlar.length > 1 ? <ColumnMenu table={table} hidden={hidden} onChange={onHiddenColumns ?? setLocalHidden} shown={cols.length} /> : null}
        </header>
      )}
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]">
            <tr>
              {cols.map(({ c, right }) => (
                <th key={c.anahtar} scope="col" className={cn(CELL, "bg-muted/50 py-2 font-medium", right ? "text-right" : "text-left")}>
                  {columnHeader(c)}
                </th>
              ))}
            </tr>
            {totalOnTop ? <TotalRow cols={cols} total={table.toplam!} sticky /> : null}
          </thead>
          <tbody>
            {table.satirlar.map((row, i) => (
              <BodyRow key={i} row={row} cols={cols} rowLink={rowLink} barColumn={barColumn} max={max} />
            ))}
          </tbody>
          {table.toplam && !totalOnTop ? (
            <tfoot className="border-t-2 bg-muted/30">
              <TotalRow cols={cols} total={table.toplam} sticky={false} />
            </tfoot>
          ) : null}
        </table>
      </div>
      {note ? <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">{note}</p> : null}
    </section>
  );
}

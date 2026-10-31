import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import type { TabloBlok, TabloHucresi } from "./sunum";
import { cellText, columnAlign, columnHeader, columnFormat, truncationNote } from "./table-model";

/** Satırdan geçiş (D4-KUC2 e): hedefi olan satır tıklanır/Enter ile açılır; hedefsiz satır düz kalır. */
export interface ReportRowLink {
  target: (row: Record<string, TabloHucresi>) => string | null;
  open: (to: string) => void;
  title: string;
}

interface Props {
  table: TabloBlok;
  rowLink?: ReportRowLink;
}

/** Sunucunun tablo bloğu; hücre metni PDF/Excel ile aynı biçimden. */
export function ReportTable({ table, rowLink }: Props) {
  const cols = table.kolonlar.map((c) => ({ c, fmt: columnFormat(table, c), right: columnAlign(table, c) === "right" }));
  const note = truncationNote(table);
  if (table.satirlar.length === 0) {
    return <p className="rounded-lg border p-4 text-sm text-muted-foreground">Tabloda gösterilecek satır yok.</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/60 text-xs text-muted-foreground">
            <tr>
              {cols.map(({ c, right }) => (
                <th key={c.anahtar} className={cn("px-3 py-2 font-medium", right ? "text-right" : "text-left")}>
                  {columnHeader(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.satirlar.map((row, i) => {
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
              <tr key={i} className={cn("border-t", to && "cursor-pointer hover:bg-muted/40")} {...linkProps}>
                {cols.map(({ c, fmt, right }) => (
                  <td key={c.anahtar} className={cn("px-3 py-1.5", right && "text-right tabular-nums")}>
                    {cellText(row[c.anahtar], fmt)}
                  </td>
                ))}
              </tr>
              );
            })}
          </tbody>
          {table.toplam ? (
            <tfoot className="border-t-2 bg-muted/30 font-semibold">
              <tr>
                {cols.map(({ c, fmt, right }) => (
                  <td key={c.anahtar} className={cn("px-3 py-1.5", right && "text-right tabular-nums")}>
                    {table.toplam![c.anahtar] === undefined ? "" : cellText(table.toplam![c.anahtar], fmt)}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {note ? <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

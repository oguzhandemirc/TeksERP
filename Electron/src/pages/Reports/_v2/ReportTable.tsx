import { cn } from "@/lib/utils";
import type { TabloBlok } from "./sunum";
import { cellText, columnAlign, columnHeader, columnFormat, truncationNote } from "./table-model";

interface Props {
  table: TabloBlok;
}

/** Sunucunun tablo bloğu; hücre metni PDF/Excel ile aynı biçimden. */
export function ReportTable({ table }: Props) {
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
            {table.satirlar.map((row, i) => (
              <tr key={i} className="border-t">
                {cols.map(({ c, fmt, right }) => (
                  <td key={c.anahtar} className={cn("px-3 py-1.5", right && "text-right tabular-nums")}>
                    {cellText(row[c.anahtar], fmt)}
                  </td>
                ))}
              </tr>
            ))}
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

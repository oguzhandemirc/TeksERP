import { cn } from "@/lib/utils";
import { toneClass } from "./figures";
import type { DonemBlok } from "./sunum";
import { periodColumns } from "./variant-model";

interface Props {
  periods: readonly DonemBlok[];
}

/**
 * Dönem kıyası (plan §3.2): dönemler yan yana sütun, son sütun bir öncekiyle kıyaslı. Kesit raporunda
 * geçmiş ölçülemez — hücre "Ölçülemedi" + nedeni (sunucunun uyarısı yukarıda); sayı uydurulmaz.
 */
export function PeriodCompareTable({ periods }: Props) {
  const cols = periodColumns(periods);
  if (cols.length === 0) return null;
  const figureName = periods[0]!.anaSayi.ad;
  return (
    <section className="rounded-lg border p-4" aria-label="Dönem kıyası">
      <h2 className="mb-3 text-sm font-semibold">Dönem kıyası</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-4 text-left font-medium">
                Ölçü
              </th>
              {cols.map((c) => (
                <th key={c.key} scope="col" className="px-3 py-2 text-right font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="py-2 pr-4 text-left font-medium">
                {figureName}
              </th>
              {cols.map((c) => (
                <td key={c.key} className="px-3 py-2 text-right align-top tabular-nums">
                  <span className={cn("block font-semibold", c.notMeasured && "font-normal text-muted-foreground")} title={c.reason}>
                    {c.value}
                  </span>
                  {c.notMeasured && c.reason ? <span className="block text-xs text-muted-foreground">{c.reason}</span> : null}
                  {c.comparison ? <span className={cn("block text-xs", toneClass(c.tone))}>{c.comparison}</span> : null}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

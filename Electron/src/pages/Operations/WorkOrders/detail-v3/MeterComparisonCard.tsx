// İE detayı "Metre karşılaştırması": parti başına beyan ↔ kurşun/tambur ölçümleri ↔ faturalanan (kullanıcı kararı 2026-11-10).
// Uç yoksa (eski backend) ya da izin yoksa kart çizilmez; renk sınıfı yalnız sunucu bayraklarından (`classifyMeterDiff`).
import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { V3Section } from "./V3Section";
import {
  METER_COMPARISON_KEY,
  METER_TONE_CLASS,
  basisBadge,
  classifyMeterDiff,
  defectNote,
  formatMeterDiff,
  getWorkOrderMeterComparison,
  meterText,
  type MeterComparison,
} from "./meterComparison";

const COLS = 8;
const td = "px-2 py-1 text-right tabular-nums whitespace-nowrap";

export function MeterComparisonView({ data }: { data: MeterComparison }) {
  const t = data.totals;
  return (
    <div className="card overflow-x-auto text-sm" data-testid="wo-meter-comparison">
      <table className="w-full">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-2 py-1">Parti no</th>
            <th className="px-2 py-1 text-right">Beyan</th>
            <th className="px-2 py-1 text-right">Kurşun çıkan</th>
            <th className="px-2 py-1 text-right">Tambura giren</th>
            <th className="px-2 py-1 text-right">Tamburdan çıkan</th>
            <th className="px-2 py-1 text-right">Fark</th>
            <th className="px-2 py-1 text-right">Faturalanan</th>
            <th className="px-2 py-1" aria-label="Fatura tabanı" />
          </tr>
        </thead>
        <tbody>
          {data.parties.map((p) => {
            const tone = classifyMeterDiff(p);
            const badge = basisBadge(p.billedBasis);
            return (
              <Fragment key={p.partyKey}>
                <tr className="border-t" data-testid="wo-meter-row" data-tone={tone}>
                  <td className="px-2 py-1 font-mono">{p.batchNo ?? "—"}</td>
                  <td className={td}>{meterText(p.declaredM)}</td>
                  <td className={td}>{meterText(p.kursunOutM)}</td>
                  <td className={td}>{meterText(p.tamburInM)}</td>
                  <td className={td}>{meterText(p.tamburCutM)}</td>
                  <td className={cn(td, METER_TONE_CLASS[tone])} title={tone === "within" ? `Tolerans içi (%${data.tolerancePct})` : undefined}>
                    {formatMeterDiff(p.diffM, p.diffPct)}
                  </td>
                  <td className={cn(td, "font-medium")}>{meterText(p.billedM)}</td>
                  <td className="px-2 py-1">
                    {badge && (
                      <Badge variant={p.billedBasis === "MEASURED" ? "secondary" : "muted"} className="text-[10px]">
                        {badge}
                      </Badge>
                    )}
                  </td>
                </tr>
                {p.defectsBeyondDeclared.map((d) => (
                  <tr key={`${p.partyKey}:${d.rollId}:${d.startMeter}`}>
                    <td colSpan={COLS} className="px-2 pb-1 text-xs text-emerald-700 dark:text-emerald-400" data-testid="wo-meter-defect">
                      {defectNote(d)}
                    </td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t font-medium" data-testid="wo-meter-total">
            <td className="px-2 py-1">Toplam</td>
            <td className={td}>{meterText(t.declaredM)}</td>
            <td className={td} colSpan={3}>
              <span className="text-xs font-normal text-muted-foreground">en yüksek ölçüm </span>
              {meterText(t.measuredMaxM)}
            </td>
            <td className={td}>{formatMeterDiff(t.diffM, null)}</td>
            <td className={td}>{meterText(t.billedM)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function MeterComparisonCard({ workOrderId }: { workOrderId: string }) {
  const q = useQuery({
    queryKey: [METER_COMPARISON_KEY, workOrderId],
    queryFn: () => getWorkOrderMeterComparison(workOrderId),
    staleTime: 30_000,
    retry: false,
  });
  if (!q.data || q.data.parties.length === 0) return null;
  return (
    <V3Section title="Metre karşılaştırması" count={`${q.data.parties.length} parti`}>
      <MeterComparisonView data={q.data} />
    </V3Section>
  );
}

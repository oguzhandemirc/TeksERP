// Özet şeridi: sunucu özeti listeyle AYNI where'den gelir (süzgeç değişince birlikte değişir).
import { fmtDiff } from "./deviation-labels";
import type { MeterDeviationSummary } from "./types";

function Cell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-card px-3 py-2" title={hint}>
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function SummaryStrip({ summary }: { summary: MeterDeviationSummary | null }) {
  const s = summary;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Sapma özeti">
      <Cell label="Sapma sayısı" value={s ? String(s.total) : "—"} />
      <Cell label="İmzasız sapma" value={s ? String(s.unsigned) : "—"} hint="Onay imzası olmayan sapmalar (bekleyenler dahil)." />
      <Cell label="İmza bekleyen" value={s ? String(s.pending) : "—"} hint="Onaylanmadan adımı kapatmayan sapmalar." />
      <Cell label="Ortalama fark" value={s ? fmtDiff(s.avgDiffMeters) : "—"} hint={s?.avgAbsDiffMeters != null ? `Mutlak ortalama ${fmtDiff(s.avgAbsDiffMeters)}` : undefined} />
    </div>
  );
}

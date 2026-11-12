// Sevke Hazır İşler — araç çubuğu (sekme + durum süzgeci), özet şeridi ve ilerleme hücresi (sunum; veri sayfada).
import { Button } from "@/components/ui/button";
import { formatMeasure, formatNumber } from "@/lib/format";
import { BandStats } from "@/components/layout/ListPage";
import { cn } from "@/lib/utils";
import type { ReadyWorkRow, ReadyWorkSummary, ReadyWorkUnit } from "./service";
import { readinessPercent, STATE_FILTERS, type ReadyStateFilter, type ReadyWorksTab } from "./ready-works-view";

const fmtM = (m: number) => `${formatNumber(m, 1)} m`;

export function SummaryStrip({ s }: { s: ReadyWorkSummary }) {
  return (
    <BandStats
      label="Sevke hazır özeti"
      items={[
        { key: "ready", label: "Hazır", value: s.ready, title: "Kurala göre sevke hazır iş sayısı" },
        { key: "partial", label: "Kısmi", value: s.partial, title: "Bir kısmı hazır, bir kısmı işlemde" },
        { key: "readyM", label: "Hazır metre", value: formatMeasure(s.readyMeters, "m") },
        { key: "procM", label: "İşlemde metre", value: formatMeasure(s.inProcessMeters, "m") },
      ]}
    />
  );
}

export function ProgressCell({ row }: { row: ReadyWorkRow }) {
  const pct = readinessPercent(row);
  return (
    <div className="flex min-w-[6rem] items-center gap-2" title={row.targetMeters ? `Hedef ${fmtM(row.targetMeters)}` : "Hedef yok — hazır / (hazır + işlemde)"}>
      <div className="h-2 flex-1 overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full", row.state === "READY" ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 text-right text-xs tabular-nums">%{pct}</span>
    </div>
  );
}

export function ReadyWorksToolbar({
  tabs,
  unit,
  onUnit,
  stateFilter,
  onStateFilter,
}: {
  tabs: ReadyWorksTab[];
  unit: ReadyWorkUnit;
  onUnit: (u: ReadyWorkUnit) => void;
  stateFilter: ReadyStateFilter;
  onStateFilter: (f: ReadyStateFilter) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="tablist" aria-label="Gruplama" className="inline-flex flex-wrap gap-1 rounded-md bg-muted p-1">
        {tabs.map((t) => (
          <button
            key={t.unit}
            type="button"
            role="tab"
            aria-selected={t.unit === unit}
            onClick={() => onUnit(t.unit)}
            className={cn(
              "rounded px-3 py-1.5 text-sm",
              t.unit === unit ? "bg-background font-medium shadow" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="inline-flex gap-1" role="group" aria-label="Durum süzgeci">
        {STATE_FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={f.key === stateFilter ? "default" : "outline"}
            aria-pressed={f.key === stateFilter}
            onClick={() => onStateFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

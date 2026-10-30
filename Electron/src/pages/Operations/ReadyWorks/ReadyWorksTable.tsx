// Sevke Hazır İşler — araç çubuğu (sekme + durum süzgeci), özet şeridi ve tablo (sunum; veri sayfada).
import type { KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReadyWorkRow, ReadyWorkSummary, ReadyWorkUnit } from "./service";
import { readinessPercent, STATE_FILTERS, STATE_LABEL, type ReadyStateFilter, type ReadyWorksTab } from "./ready-works-view";

const fmtM = (m: number) => `${formatNumber(m, 1)} m`;

export function SummaryStrip({ s }: { s: ReadyWorkSummary }) {
  const cells: Array<[string, string, string?]> = [
    ["Hazır", String(s.ready), "Kurala göre sevke hazır iş sayısı"],
    ["Kısmi", String(s.partial), "Bir kısmı hazır, bir kısmı işlemde"],
    ["Hazır metre", fmtM(s.readyMeters)],
    ["İşlemde metre", fmtM(s.inProcessMeters)],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Sevke hazır özeti">
      {cells.map(([label, value, hint]) => (
        <div key={label} className="min-w-0 rounded-md border bg-card px-3 py-2" title={hint}>
          <div className="truncate text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold tabular-nums">{value}</div>
        </div>
      ))}
    </div>
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

export function ReadyWorksTable({ rows, unit, unitLabel, onOpen }: { rows: ReadyWorkRow[]; unit: ReadyWorkUnit; unitLabel: string; onOpen: (r: ReadyWorkRow) => void }) {
  const onKey = (e: KeyboardEvent, row: ReadyWorkRow) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(row);
    }
  };
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{unitLabel}</TableHead>
            {unit !== "customer" && <TableHead className="hidden sm:table-cell">Müşteri</TableHead>}
            <TableHead>Durum</TableHead>
            <TableHead>İlerleme</TableHead>
            <TableHead className="whitespace-nowrap text-right">Hazır</TableHead>
            <TableHead className="hidden whitespace-nowrap text-right md:table-cell">İşlemde</TableHead>
            <TableHead className="hidden whitespace-nowrap text-right lg:table-cell">Sevk edilen</TableHead>
            <TableHead className="hidden whitespace-nowrap text-right lg:table-cell">Hedef</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={`${r.unit}:${r.id}`}
              role="button"
              tabIndex={0}
              className="cursor-pointer"
              onClick={() => onOpen(r)}
              onKeyDown={(e) => onKey(e, r)}
              aria-label={`${r.label} toplarını aç`}
            >
              <TableCell className="min-w-[8rem] font-medium">{r.label}</TableCell>
              {unit !== "customer" && <TableCell className="hidden sm:table-cell">{r.customerName ?? "—"}</TableCell>}
              <TableCell>
                <Badge variant={r.state === "READY" ? "default" : r.state === "PARTIAL" ? "secondary" : "muted"} className="whitespace-nowrap">
                  {STATE_LABEL[r.state]}
                </Badge>
              </TableCell>
              <TableCell><ProgressCell row={r} /></TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums">
                {r.readyCount} top
                <div className="text-xs text-muted-foreground">{fmtM(r.readyMeters)}</div>
              </TableCell>
              <TableCell className="hidden whitespace-nowrap text-right tabular-nums md:table-cell">
                {r.inProcessCount} top
                <div className="text-xs text-muted-foreground">{fmtM(r.inProcessMeters)}</div>
              </TableCell>
              <TableCell className="hidden whitespace-nowrap text-right tabular-nums lg:table-cell">{fmtM(r.shippedMeters)}</TableCell>
              <TableCell className="hidden whitespace-nowrap text-right tabular-nums lg:table-cell">{r.targetMeters == null ? "—" : fmtM(r.targetMeters)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

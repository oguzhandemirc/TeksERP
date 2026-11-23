// Tezgâh yük çizelgesi (Gantt) — solda tablo (tezgâh › iş sırası, kalan, süre, boşalma), sağda zaman ekseni.
// Tezgâh satırı özet çubuğu taşır, iş satırı kendi çubuğunu; süresi bilinmeyen iş taralı ve uçsuz çizilir.
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WEAVING_STATUS_META } from "../WeavingOrders/types";
import type { LoomLoadRow } from "./types";
import { type AxisTick, type TimelineAxis, labelStep, pct } from "./loom-load-axis";
import { DASH, freeAtCell, hoursText, jobHoursHint, jobSlots, jobTitle, metersText, remainingHint } from "./loom-load-text";
import { Val } from "./LoomLoadParts";

/** Tablo ve eksenin ortak sütun düzeni; zaman ekseni kalan genişliği alır. */
export const GRID = "grid grid-cols-[minmax(12rem,26rem)_4.5rem_7.5rem_7.5rem_minmax(16rem,1fr)]";
const HATCH = "bg-[repeating-linear-gradient(135deg,hsl(var(--muted-foreground)/0.35)_0_4px,transparent_4px_8px)]";

function Grid({ axis }: { axis: TimelineAxis }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {axis.ticks.map((t) => (
        <span key={t.h} className={cn("absolute inset-y-0 w-px", t.major ? "bg-border" : "bg-border/40")} style={{ left: pct(t.h, axis.spanH) }} />
      ))}
      <span className="absolute inset-y-0 w-0.5 bg-destructive/70" style={{ left: pct(axis.nowH, axis.spanH) }} />
    </div>
  );
}

function TickLabel({ t, spanH }: { t: AxisTick; spanH: number }) {
  if (!t.label) return null;
  return (
    <span
      className={cn("absolute top-0 whitespace-nowrap pl-1 tabular-nums", t.major ? "font-medium text-foreground/80" : "text-muted-foreground/70")}
      style={{ left: pct(t.h, spanH) }}
    >
      {t.label}
    </span>
  );
}

/** Zaman ekseni sütununun piksel genişliği — etiket seyreltmesi için. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(e?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function ChartHead({ axis }: { axis: TimelineAxis }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const days = axis.ticks.filter((t) => t.major).length;
  const step = labelStep(days, width);
  const showMinor = step === 1 && width / Math.max(1, days) >= 160;
  let dayIdx = -1;
  const labels = axis.ticks.map((t) => {
    if (t.major) dayIdx += 1;
    const visible = t.major ? dayIdx % step === 0 : showMinor;
    return visible ? t : { ...t, label: "" };
  });
  return (
    <div className={cn(GRID, "sticky top-0 z-10 h-8 items-center border-b bg-card text-[11px] font-medium uppercase tracking-wide text-muted-foreground")} role="row">
      <span className="px-3" role="columnheader">Tezgâh · iş sırası</span>
      <span className="pr-3 text-right" role="columnheader">Kalan</span>
      <span className="pr-3 text-right" role="columnheader">Süre</span>
      <span className="pr-3 text-right" role="columnheader">Boşalır</span>
      <div ref={ref} className="relative h-full overflow-hidden border-l normal-case tracking-normal" role="columnheader" aria-label="Zaman ekseni">
        <div className="absolute inset-x-0 top-2 h-4">
          {labels.map((t) => <TickLabel key={t.h} t={t} spanH={axis.spanH} />)}
        </div>
      </div>
    </div>
  );
}

/** Çubuk: başlangıç ve süre saat cinsinden; süre yoksa eksen sonuna kadar taralı. */
function Bar({ startH, hours, axis, tone, label, title }: { startH: number; hours: number | null; axis: TimelineAxis; tone: "run" | "beam" | "summary"; label?: string; title: string }) {
  const from = axis.nowH + startH;
  if (from >= axis.spanH) return <span className="absolute inset-y-0 right-1 flex items-center text-[10px] text-muted-foreground" title={title}>›</span>;
  const width = hours == null ? `calc(100% - ${pct(from, axis.spanH)})` : `max(3px, calc(${pct(from + hours, axis.spanH)} - ${pct(from, axis.spanH)}))`;
  const cls =
    hours == null ? cn(HATCH, "border border-dashed border-muted-foreground/50 text-foreground")
    : tone === "summary" ? "bg-foreground/60"
    : tone === "run" ? "bg-primary text-primary-foreground"
    : "border border-primary/60 bg-primary/15 text-foreground";
  return (
    <span
      className={cn("absolute inset-y-0 my-auto flex items-center overflow-hidden rounded-[3px] px-1.5 text-[11px] font-medium leading-none", tone === "summary" ? "h-1.5" : "h-5", cls)}
      style={{ left: pct(from, axis.spanH), width }}
      title={title}
    >
      {label && <span className={cn("truncate", hours == null && "rounded-sm bg-card/90 px-1")}>{label}</span>}
    </span>
  );
}

export function LoomGroup({ loom, axis }: { loom: LoomLoadRow; axis: TimelineAxis }) {
  const free = freeAtCell(loom);
  const slots = jobSlots(loom);
  return (
    <div role="rowgroup" data-testid="loom-load-card" className="border-b last:border-b-0">
      <div role="row" className={cn(GRID, "h-9 items-center bg-muted/40 text-sm")}>
        <span className="flex min-w-0 items-baseline gap-2 px-3">
          <span className="font-mono text-xs font-semibold">{loom.code}</span>
          <span className="truncate text-muted-foreground">{loom.name}</span>
        </span>
        <span className="pr-3 text-right text-xs text-muted-foreground">{loom.jobs.length ? `${loom.jobs.length} iş` : "iş yok"}</span>
        <Val className="pr-3 text-right text-xs font-medium" text={loom.jobs.length ? hoursText(loom.totalEstimatedHours) : DASH} hint={loom.totalEstimatedHours == null ? "En az bir işin süresi hesaplanamadı." : null} />
        <span className={cn("pr-3 text-right text-xs font-medium", loom.jobs.length === 0 && "text-success")} data-testid="loom-load-free-at">
          <Val text={free.text} hint={free.hint} />
        </span>
        <div className="relative h-full border-l">
          <Grid axis={axis} />
          {loom.jobs.length > 0 && <Bar startH={0} hours={loom.totalEstimatedHours} axis={axis} tone="summary" title={`Toplam ${hoursText(loom.totalEstimatedHours)}`} />}
        </div>
      </div>
      {slots.map(({ job, startH, hours }) => {
        const meta = WEAVING_STATUS_META[job.status];
        const title = jobTitle(job, loom);
        return (
          <div key={job.weavingOrderId} role="row" data-testid="loom-load-job" className={cn(GRID, "h-8 items-center border-t border-border/50 text-sm hover:bg-muted/30")} title={title}>
            <span className="flex min-w-0 items-center gap-2 pl-7 pr-3">
              <span className="font-mono text-xs">{job.weavingOrderNumber}</span>
              <span className="min-w-0 truncate">{job.itemCode} · {job.itemName}</span>
              {meta && <Badge className={cn("hidden shrink-0 px-1.5 py-0 text-[10px] xl:inline-flex", meta.badgeClass)}>{meta.label}</Badge>}
            </span>
            <Val text={metersText(job.remainingM)} hint={remainingHint(job)} className="pr-3 text-right text-xs" />
            <Val text={hoursText(job.estimatedHours)} hint={jobHoursHint(job, loom)} className="pr-3 text-right text-xs" />
            <span aria-hidden />
            <div className="relative h-full border-l">
              <Grid axis={axis} />
              {startH != null && (
                <Bar startH={startH} hours={hours} axis={axis} tone={job.assignment === "OPEN_RUN" ? "run" : "beam"} label={job.weavingOrderNumber} title={title} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

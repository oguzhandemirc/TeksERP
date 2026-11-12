// Tezgâh yük çizelgesi parçaları — tezgâh kartı, iş satırı, tezgâhsız işler. Değer yoksa "—" + nedenini söyleyen ipucu.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WEAVING_STATUS_META } from "../WeavingOrders/types";
import type { LoomLoadJob, LoomLoadJobBase, LoomLoadRow } from "./types";
import { DASH, assignmentText, freeAtCell, hoursText, jobHoursHint, metersText, remainingHint } from "./loom-load-text";

/** Değer ya da "—"; "—" ise üzerine gelince neden (ekran okuyucu için aria-label). */
export function Val({ text, hint, className }: { text: string; hint: string | null; className?: string }) {
  if (text !== DASH || !hint) return <span className={cn("tabular-nums", className)}>{text}</span>;
  return (
    <span className={cn("cursor-help tabular-nums text-muted-foreground underline decoration-dotted", className)} title={hint} aria-label={`bilinmiyor: ${hint}`}>
      {DASH}
    </span>
  );
}

function JobLine({ job, loom }: { job: LoomLoadJob; loom: LoomLoadRow }) {
  const meta = WEAVING_STATUS_META[job.status];
  return (
    <li className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 py-1.5 text-sm" data-testid="loom-load-job">
      <div className="min-w-0">
        <span className="font-mono text-xs">{job.weavingOrderNumber}</span>{" "}
        <span className="truncate">{job.itemCode} · {job.itemName}</span>
        <div className="text-xs text-muted-foreground">
          {assignmentText(job.assignment)}
          {meta ? <Badge className={cn("ml-1.5 px-1.5 py-0 text-[10px]", meta.badgeClass)}>{meta.label}</Badge> : null}
        </div>
      </div>
      <Val text={metersText(job.remainingM)} hint={remainingHint(job)} className="text-right" />
      <Val text={hoursText(job.estimatedHours)} hint={jobHoursHint(job, loom)} className="w-28 text-right" />
    </li>
  );
}

export function LoomCard({ loom }: { loom: LoomLoadRow }) {
  const free = freeAtCell(loom);
  return (
    <Card data-testid="loom-load-card">
      <CardHeader className="flex-row items-baseline justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base">
          <span className="font-mono">{loom.code}</span> <span className="font-normal text-muted-foreground">{loom.name}</span>
        </CardTitle>
        <span className="text-xs text-muted-foreground">{loom.jobs.length ? `${loom.jobs.length} iş` : "iş yok"}</span>
      </CardHeader>
      <CardContent className="space-y-2">
        {loom.jobs.length > 0 && (
          <>
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-xs text-muted-foreground">
              <span>İş sırası</span><span className="text-right">Kalan</span><span className="w-28 text-right">Tahmini süre</span>
            </div>
            <ol className="divide-y">{loom.jobs.map((j) => <JobLine key={j.weavingOrderId} job={j} loom={loom} />)}</ol>
          </>
        )}
        <dl className="grid grid-cols-2 gap-x-3 border-t pt-2 text-sm">
          <dt className="text-muted-foreground">Toplam süre</dt>
          <dd className="text-right">
            <Val text={hoursText(loom.totalEstimatedHours)} hint={loom.totalEstimatedHours == null ? "En az bir işin süresi hesaplanamadı." : null} />
          </dd>
          <dt className="text-muted-foreground">Kesintisiz çalışırsa boşalır</dt>
          <dd className={cn("text-right", loom.jobs.length === 0 && "text-success")} data-testid="loom-load-free-at">
            <Val text={free.text} hint={free.hint} />
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}

export function UnassignedSection({ jobs }: { jobs: LoomLoadJobBase[] }) {
  if (jobs.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby="loom-load-unassigned">
      <h2 id="loom-load-unassigned" className="text-sm font-semibold">Tezgâh bekleyen işler ({jobs.length})</h2>
      <p className="text-xs text-muted-foreground">Açık koşumu ya da takılı leventi olmayan planlı işler; bir tezgâhta başlayınca o tezgâhın sırasına girer.</p>
      <ul className="divide-y border-y">
        {jobs.map((j) => (
          <li key={j.weavingOrderId} className="grid grid-cols-[1fr_auto] gap-x-3 py-1.5 text-sm" data-testid="loom-load-unassigned-job">
            <span className="min-w-0 truncate">
              <span className="font-mono text-xs">{j.weavingOrderNumber}</span> {j.itemCode} · {j.itemName}
            </span>
            <Val text={metersText(j.remainingM)} hint={remainingHint(j)} className="text-right" />
          </li>
        ))}
      </ul>
    </section>
  );
}

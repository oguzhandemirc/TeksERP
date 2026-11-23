// Tezgâh yük çizelgesi yardımcı parçaları — "—" ipucu, lejant, tezgâhsız işler. Değer yoksa "—" + nedenini söyleyen ipucu.
import { InfoPopover } from "@/components/ui/info-popover";
import { cn } from "@/lib/utils";
import type { LoomLoadJobBase } from "./types";
import { DASH, metersText, remainingHint } from "./loom-load-text";

/** Değer ya da "—"; "—" ise üzerine gelince neden (ekran okuyucu için aria-label). */
export function Val({ text, hint, className }: { text: string; hint: string | null; className?: string }) {
  if (text !== DASH || !hint) return <span className={cn("tabular-nums", className)}>{text}</span>;
  return (
    <span className={cn("cursor-help tabular-nums text-muted-foreground underline decoration-dotted", className)} title={hint} aria-label={`bilinmiyor: ${hint}`}>
      {DASH}
    </span>
  );
}

const SWATCH = "inline-block h-2.5 w-4 rounded-[2px]";

/** Çubuk renklerinin anahtarı — geniş ekranda araç çubuğunda açık, darda ⓘ balonunda. */
export function Legend() {
  return (
    <>
      <LegendItems className="hidden 2xl:flex" />
      <span className="2xl:hidden"><InfoPopover label="Çizelge anahtarı" desc={<LegendItems className="flex flex-col items-start gap-1.5" />} /></span>
    </>
  );
}

function LegendItems({ className }: { className?: string }) {
  return (
    <div className={cn("items-center gap-3 text-xs text-muted-foreground", className)}>
      <span className="flex items-center gap-1.5"><span className={cn(SWATCH, "bg-primary")} />Dokunuyor</span>
      <span className="flex items-center gap-1.5"><span className={cn(SWATCH, "border border-primary/60 bg-primary/15")} />Levent takılı</span>
      <span className="flex items-center gap-1.5">
        <span className={cn(SWATCH, "border border-dashed border-muted-foreground/50 bg-[repeating-linear-gradient(135deg,hsl(var(--muted-foreground)/0.35)_0_3px,transparent_3px_6px)]")} />Süre bilinmiyor
      </span>
      <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-0.5 bg-destructive/70" />Şimdi</span>
    </div>
  );
}

export function UnassignedSection({ jobs }: { jobs: LoomLoadJobBase[] }) {
  if (jobs.length === 0) return null;
  return (
    <section className="rounded-lg border border-card-border bg-card shadow-card" aria-labelledby="loom-load-unassigned">
      <header className="flex h-9 items-center gap-1.5 border-b px-3">
        <h2 id="loom-load-unassigned" className="text-sm font-semibold">Tezgâh bekleyen işler ({jobs.length})</h2>
        <InfoPopover label="Tezgâh bekleyen işler" desc="Açık koşumu ya da takılı leventi olmayan planlı işler; bir tezgâhta başlayınca o tezgâhın sırasına girer." />
      </header>
      <ul>
        {jobs.map((j) => (
          <li key={j.weavingOrderId} className="grid h-8 grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-3 border-t border-border/50 px-3 text-sm first:border-t-0" data-testid="loom-load-unassigned-job">
            <span className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-xs">{j.weavingOrderNumber}</span>
              <span className="truncate">{j.itemCode} · {j.itemName}</span>
            </span>
            <Val text={metersText(j.remainingM)} hint={remainingHint(j)} className="text-right text-xs" />
          </li>
        ))}
      </ul>
    </section>
  );
}

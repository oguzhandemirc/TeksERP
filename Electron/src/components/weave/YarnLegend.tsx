// Kart görseli lejantı — renk karesi + harf + iplik adı. Dolu kare anlamı geleneğe göre değişebildiği için
// (İsveç kâğıdında ters) her ızgaranın yanında anlamı yazılı durur.
import { cn } from "@/lib/utils";

export interface LegendEntry {
  color: string;
  /** Kısa işaret (A, B, Ç…); ad yoksa yalnız bu yazılır. */
  mark?: string;
  label: string;
  /** Ek bilgi (ör. "5 atkı"). */
  note?: string;
}

export function YarnLegend({ entries, className }: { entries: readonly LegendEntry[]; className?: string }) {
  if (entries.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground", className)} aria-label="Renk açıklaması">
      {entries.map((e, i) => (
        <li key={i} className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 shrink-0 rounded-[2px] border border-border" style={{ background: e.color }} />
          {e.mark && <span className="font-mono font-semibold text-foreground">{e.mark}</span>}
          <span className="truncate">{e.label}</span>
          {e.note && <span className="tabular-nums">· {e.note}</span>}
        </li>
      ))}
    </ul>
  );
}

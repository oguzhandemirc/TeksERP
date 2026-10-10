// Bir hol: başlıkta hol adı, çalışan/toplam ve holün "bugün %"i (en iyi hol kupa
// alır); altında tezgahlar tezgah numarası sırasıyla (gerçek kat planı yok).
import { Trophy } from "lucide-react";
import { LoomCard } from "./LoomCard";
import { hsl } from "./palette";
import { summarizeFloor } from "./metrics";
import type { LiveLoom } from "./types";

interface Props {
  hall: string;
  looms: readonly LiveLoom[];
  now: number;
  highlight: { starId: string | null; bestHall: boolean; onSelect: (id: string) => void };
  /** Sabit kolon sayısı (tam ekran: en kalabalık holün tezgah adedi — holler hizalı, kaydırmasız). */
  columns?: number;
}

export function HallSection({ hall, looms, now, highlight, columns }: Props) {
  const s = summarizeFloor(looms, now);
  const ratio = (s.todayPct ?? 0) / 100;
  return (
    <section aria-label={`Hol ${hall}`} className="space-y-2">
      <header className="flex items-center gap-3">
        <h2 className="text-[1.15em] font-extrabold" style={{ color: hsl("var(--ds-ink)") }}>
          Hol {hall}
        </h2>
        <span className="text-[0.9em] font-semibold tabular-nums text-muted-foreground">
          {s.running}/{s.total}
        </span>
        <div className="h-1.5 w-24 overflow-hidden rounded-full" style={{ background: hsl("var(--ds-ink)", 0.1) }} title="Holün bugünkü çalışma süresi payı: çalışılan süre / planlı süre">
          <div className="h-full rounded-full transition-[width] duration-1000" style={{ width: `${ratio * 100}%`, background: hsl("var(--ds-run)") }} />
        </div>
        <span className="text-[0.9em] font-bold tabular-nums" style={{ color: hsl("var(--ds-ink)") }}>
          <span className="mr-1 text-[0.8em] font-semibold text-muted-foreground">bugün</span>
          {s.todayPct === null ? "—" : `%${s.todayPct}`}
        </span>
        {highlight.bestHall && <Trophy className="h-4 w-4" style={{ color: hsl("var(--ds-over)") }} aria-label="Bugünün en iyi holü" />}
        <div className="h-px flex-1" style={{ background: hsl("var(--ds-ink)", 0.1) }} />
      </header>
      <div
        className="grid gap-2.5"
        style={{ gridTemplateColumns: columns ? `repeat(${columns}, minmax(0, 1fr))` : "repeat(auto-fill, minmax(7.5em, 1fr))" }}
      >
        {looms.map((t) => (
          <LoomCard key={t.id} loom={t} now={t.openStop ? now : 0} star={highlight.starId === t.id} onSelect={highlight.onSelect} />
        ))}
      </div>
    </section>
  );
}

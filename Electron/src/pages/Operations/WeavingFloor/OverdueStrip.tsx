// Hedef süreyi aşan duruşlar — yalnız varsa görünen ince şerit; en uzun bekleyen
// başta. Her öğe tıklanır, tezgah detayını açar.
import { Crown, Timer } from "lucide-react";
import { TIER_COLOR, hsl } from "./palette";
import { escalationTierOf, formatShortDuration, overdueLooms } from "./metrics";
import { reasonOf } from "./stopReasons";
import type { LiveLoom } from "./types";

interface Props {
  looms: readonly LiveLoom[];
  now: number;
  onSelect: (id: string) => void;
}

export function OverdueStrip({ looms, now, onSelect }: Props) {
  const list = overdueLooms(looms, now);
  if (list.length === 0) return null;
  return (
    <section
      aria-label="Hedef süreyi aşan duruşlar"
      className="flex items-center gap-3 overflow-x-auto rounded-2xl px-3 py-2"
      style={{ background: hsl("var(--ds-over)", 0.12), boxShadow: `inset 3px 0 0 ${hsl("var(--ds-over)")}` }}
    >
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-bold" style={{ color: hsl("var(--ds-ink)") }}>
        <Timer className="h-4 w-4" style={{ color: hsl("var(--ds-over)") }} />
        Hedefi aşan {list.length}
      </span>
      <div className="flex gap-2">
        {list.map((t) => {
          const stop = t.openStop!;
          const r = reasonOf(stop.reasonCode);
          const tier = escalationTierOf(stop, now);
          const Icon = r.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ background: hsl("var(--ds-tile)"), color: hsl(TIER_COLOR[tier]) }}
              aria-label={`Tezgah ${t.code}, ${r.label}, ${formatShortDuration(now - stop.startedAt)}, hedef ${r.targetMin} dk`}
            >
              <span className="font-extrabold" style={{ color: hsl("var(--ds-ink)") }}>{t.code}</span>
              <Icon className="h-4 w-4" />
              {formatShortDuration(now - stop.startedAt)}
              <span className="text-xs font-medium text-muted-foreground">/ {r.targetMin} dk</span>
              {tier === "ESCALATED" && <Crown className="h-4 w-4" aria-label="Patrona iletildi" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

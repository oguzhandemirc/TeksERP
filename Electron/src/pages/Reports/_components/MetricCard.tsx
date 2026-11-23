import { Gauge, type LucideIcon } from "lucide-react";
import { AnimatedNumber } from "@/components/motion";
import { IconTile, type IconTileTone } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string | number | null | undefined;
  hint?: string;
  icon?: LucideIcon;
  /** "ok" | "warn" | "bad" — simge karesi ve (uyarıda) değer rengi. */
  tone?: "neutral" | "ok" | "warn" | "bad";
  isLoading?: boolean;
}

const TONE_TILE: Record<NonNullable<Props["tone"]>, IconTileTone> = {
  neutral: "sky",
  ok: "green",
  warn: "amber",
  bad: "rose",
};

const TONE_VALUE: Record<NonNullable<Props["tone"]>, string> = {
  neutral: "",
  ok: "",
  warn: "text-warning",
  bad: "text-destructive",
};

/**
 * KPI kartı — v2 sayı kartıyla (`_v2/HeadlineCard`) aynı dil: simge karesi + etiket + büyük değer.
 * `h-full`: ızgaradaki kartlar eşit boy (ipucu olan/olmayan kart farklı yükseklikte durmaz).
 */
export function MetricCard({ label, value, hint, icon, tone = "neutral", isLoading }: Props) {
  const display = value === null || value === undefined || value === "" ? "—" : value;
  return (
    <div className="flex h-full min-w-0 items-center gap-3 rounded-xl border border-card-border bg-card p-4 shadow-card" data-testid="metric-card">
      <IconTile icon={icon ?? Gauge} tone={TONE_TILE[tone]} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-muted-foreground" title={label}>
          {label}
        </p>
        <p className={cn("mt-0.5 truncate text-2xl font-bold leading-tight tracking-tight tabular-nums", TONE_VALUE[tone])}>
          {isLoading ? (
            <span className="text-muted-foreground/40">…</span>
          ) : typeof display === "number" ? (
            <AnimatedNumber value={display} />
          ) : (
            display
          )}
        </p>
        {hint ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={hint}>
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

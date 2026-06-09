import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Level } from "./serverHealth";

const TONE: Record<Level, { bar: string; text: string }> = {
  ok: { bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  warn: { bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  crit: { bar: "bg-destructive", text: "text-destructive" },
};

interface Props {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  /** 0-100 arası doluluk; verilirse çubuk çizilir. */
  pct?: number | null;
  /** Eşik durumuna göre renk (yoksa pct'den türetilmez, nötr kalır). */
  level?: Level;
  /** Mini trend grafiği (Sparkline). */
  chart?: ReactNode;
}

export function MetricCard({ icon: Icon, label, value, sub, pct, level = "ok", chart }: Props) {
  const hasBar = pct != null && !isNaN(pct);
  const clamped = hasBar ? Math.min(100, Math.max(0, pct as number)) : 0;
  const tone = TONE[level];
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <div className="flex items-baseline gap-2">
          <span className={cn("text-2xl font-semibold tabular-nums", level !== "ok" && tone.text)}>
            {value}
          </span>
          {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
        </div>
        {hasBar && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-all", tone.bar)}
              style={{ width: clamped + "%" }}
            />
          </div>
        )}
        {chart}
      </CardContent>
    </Card>
  );
}

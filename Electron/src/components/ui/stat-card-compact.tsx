import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDisplay } from "@/lib/format";
import { IconTile } from "./icon-tile";
import type { StatCardProps } from "./stat-card";

/** Değişim satırının rengi: artışın kötü olduğu ölçüde (`invertTrend`) yön ters okunur. */
export function trendTone(trend: StatCardProps["trend"], invert?: boolean): string {
  if (!trend || trend === "neutral") return "text-muted-foreground";
  return (trend === "up") !== Boolean(invert) ? "text-success" : "text-destructive";
}

export function TrendArrow({ trend }: { trend: StatCardProps["trend"] }) {
  const Arrow = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : null;
  return Arrow ? <Arrow className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null;
}

/** Kompakt KPI kartı (hedef görsel): simge karesi solda; etiket, değer (+ kısa ek), değişim satırı sağda.
 *  Pano değişim yokken kısa nötr metin verir → şeritteki kartlar aynı yükseklikte. */
export function CompactStatCard({ label, value, icon, tone = "primary", delta, trend = "neutral", invertTrend, hint, onClick, loading, valueFit, className }: StatCardProps) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp type={onClick ? "button" : undefined} onClick={onClick} data-slot="card" data-layout="compact"
      className={cn(
        "@container flex w-full min-w-0 items-center gap-3 rounded-xl border border-card-border bg-card px-[var(--kpi-px)] py-[var(--kpi-py)] text-left text-card-foreground shadow-card",
        onClick && "transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}>
      {icon && <IconTile icon={icon} tone={tone} size="md" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <p className="flex min-w-0 items-baseline gap-1.5 leading-tight">
          <span data-value-fit={valueFit || undefined} className={cn("min-w-0 font-bold tabular-nums", valueFit ? "break-normal text-sm @[13rem]:text-base @[16rem]:text-lg" : "truncate text-lg")}>
            {loading ? <span className="skeleton-shimmer inline-block h-5 w-16 rounded-md bg-muted align-middle" /> : typeof value === "number" ? formatDisplay(value) : value}
          </span>
          {/* Ek bilgi yalnız yer varsa: değer hiç kırpılmasın. */}
          {hint != null && <span className="hidden min-w-0 shrink truncate text-xs text-muted-foreground @[15rem]:inline">{hint}</span>}
        </p>
        {delta != null && (
          <p data-trend={trend} className={cn("flex h-4 items-center gap-0.5 truncate text-xs font-medium", trendTone(trend, invertTrend))}>
            <TrendArrow trend={trend} />
            <span className="truncate">{delta}</span>
          </p>
        )}
      </div>
    </Comp>
  );
}

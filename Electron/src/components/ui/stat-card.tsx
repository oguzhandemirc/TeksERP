import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDisplay } from "@/lib/format";
import { IconTile, type IconTileTone } from "./icon-tile";

export interface StatCardProps {
  /** Küçük gri etiket ("Açık sipariş"). */
  label: ReactNode;
  /** Kalın büyük değer — biçimlenmiş metin ya da düğüm; ham sayı ortak gösterim biçimiyle basılır ("4.295"). */
  value: ReactNode;
  icon?: LucideIcon;
  tone?: IconTileTone;
  /** Değişim satırı metni ("%12,5 geçen aya göre"). */
  delta?: ReactNode;
  /** Değişim yönü: up = yeşil ok, down = kırmızı ok, neutral = gri (ok yok). */
  trend?: "up" | "down" | "neutral";
  /** Artışın KÖTÜ olduğu ölçüler (ör. fire) — renk yönü ters çevrilir, ok yönü aynı kalır. */
  invertTrend?: boolean;
  /** Değerin altında küçük ek satır (değişim yerine ya da yanında). */
  hint?: ReactNode;
  onClick?: () => void;
  loading?: boolean;
  /** `stacked`: simge + etiket üst satırda, değer ve değişim tam genişlikte (dar, çok kartlı şeritler). */
  layout?: "row" | "stacked";
  className?: string;
}

/** KPI kartı (hedef görsel): solda renkli simge karesi, etiket, kalın değer, altında değişim satırı. */
export function StatCard({ label, value, icon, tone = "primary", delta, trend = "neutral", invertTrend, hint, onClick, loading, layout = "row", className }: StatCardProps) {
  const good = trend === "neutral" ? null : (trend === "up") !== Boolean(invertTrend);
  const Arrow = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : null;
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-slot="card"
      className={cn(
        "flex w-full min-w-0 gap-3 rounded-xl border border-card-border bg-card p-4 text-left text-card-foreground shadow-card",
        layout === "row" && "items-center",
        onClick && "transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {icon && layout === "row" && <IconTile icon={icon} tone={tone} size="md" />}
      <div className="min-w-0 flex-1">
        {layout === "stacked" ? (
          <div className="mb-2 flex items-center gap-2.5">
            {icon && <IconTile icon={icon} tone={tone} size="sm" />}
            <p className="truncate text-sm font-semibold text-muted-foreground">{label}</p>
          </div>
        ) : (
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        )}
        <p className={cn("mt-0.5 truncate font-bold leading-tight tabular-nums", layout === "stacked" ? "text-2xl" : "text-xl")}>
          {loading ? <span className="skeleton-shimmer inline-block h-6 w-20 rounded-md bg-muted align-middle" /> : typeof value === "number" ? formatDisplay(value) : value}
        </p>
        {delta != null && (
          <p
            data-trend={trend}
            className={cn(
              "mt-1 flex items-center gap-0.5 truncate text-xs font-medium",
              good === null ? "text-muted-foreground" : good ? "text-success" : "text-destructive",
            )}
          >
            {Arrow && <Arrow className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="truncate">{delta}</span>
          </p>
        )}
        {hint != null && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
    </Comp>
  );
}

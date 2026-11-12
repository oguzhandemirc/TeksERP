import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { IconTile, type IconTileTone } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";

export interface MetricDelta {
  /** Renkli parça ("%12,5"). */
  text: string;
  trend: "up" | "down" | "neutral";
  /** Gri kıyas ("önceki döneme göre"). */
  caption?: string;
  /** Tam açıklama (ipucu). */
  title?: string;
  /** Düşüş iyi mi (ör. fire) — renk ters döner. */
  invert?: boolean;
}

export interface MetricListItemProps {
  icon: LucideIcon;
  tone: IconTileTone;
  label: string;
  value: string;
  delta?: MetricDelta | null;
  /** Değerin altında küçük ek bilgi ("42 top"). */
  hint?: ReactNode;
  onClick?: () => void;
}

/** Dikey sayı listesi satırı (hedef görsel "öne çıkan sayılar"): simge karesi + ad + değer + değişim. */
export function MetricListItem({ icon, tone, label, value, delta, hint, onClick }: MetricListItemProps) {
  const good = !delta || delta.trend === "neutral" ? null : (delta.trend === "up") !== Boolean(delta.invert);
  const Arrow = delta?.trend === "up" ? ArrowUpRight : delta?.trend === "down" ? ArrowDownRight : null;
  const body = (
    <>
      <IconTile icon={icon} tone={tone} size="lg" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
        <span className="block text-lg font-bold leading-tight tabular-nums">{value}</span>
        {delta ? (
          <span title={delta.title} className="flex flex-wrap items-center gap-x-1 text-xs">
            <span className={cn("inline-flex items-center font-semibold", good === null ? "text-muted-foreground" : good ? "text-success" : "text-destructive")}>
              {Arrow && <Arrow className="h-3.5 w-3.5" aria-hidden />}
              {delta.text}
            </span>
            {delta.caption && <span className="text-muted-foreground">{delta.caption}</span>}
          </span>
        ) : hint ? (
          <span className="block truncate text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </span>
    </>
  );
  const cls = "flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left";
  return (
    <li>
      {onClick ? (
        <button type="button" onClick={onClick} className={cn(cls, "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

export function MetricList({ children, label }: { children: ReactNode; label: string }) {
  return <ul aria-label={label} className="flex flex-col gap-1.5">{children}</ul>;
}

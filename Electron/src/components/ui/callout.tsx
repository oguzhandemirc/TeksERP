import type { ReactNode } from "react";
import { Info, AlertTriangle, CheckCircle2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type CalloutTone = "info" | "warning" | "success" | "danger" | "muted";

/**
 * Tutarlı bilgi/uyarı kutusu. Tek kaynak: bütün form ve panellerde "bu bir
 * uyarı / bu bir bilgi" ayrımı aynı renk + ikon dilini kullansın diye.
 * Renkler semantik token'lardan (`info`/`warning`/`success`/`destructive`) —
 * raw hex yok, tema (açık/koyu) ile uyumlu.
 */
const TONES: Record<
  CalloutTone,
  { wrap: string; icon: string; defaultIcon: LucideIcon }
> = {
  info: {
    wrap: "border-info/30 bg-info/10",
    icon: "text-info",
    defaultIcon: Info,
  },
  warning: {
    wrap: "border-warning/45 bg-warning/10",
    icon: "text-warning",
    defaultIcon: AlertTriangle,
  },
  success: {
    wrap: "border-success/35 bg-success/10",
    icon: "text-success",
    defaultIcon: CheckCircle2,
  },
  danger: {
    wrap: "border-destructive/40 bg-destructive/10",
    icon: "text-destructive",
    defaultIcon: AlertTriangle,
  },
  muted: {
    wrap: "border-border bg-muted/40",
    icon: "text-muted-foreground",
    defaultIcon: Info,
  },
};

interface Props {
  tone?: CalloutTone;
  /** İkonu değiştir; `null` ile ikonu kaldır. */
  icon?: LucideIcon | null;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function Callout({ tone = "info", icon, title, children, className }: Props) {
  const t = TONES[tone];
  const Icon = icon === null ? null : (icon ?? t.defaultIcon);
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-md border p-3 text-xs text-foreground",
        t.wrap,
        className,
      )}
    >
      {Icon && <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", t.icon)} />}
      <div className="min-w-0 flex-1 space-y-0.5 [&_strong]:font-semibold">
        {title && <div className="font-semibold leading-snug">{title}</div>}
        {children && (
          <div className={cn("leading-snug", title && "text-foreground/80")}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

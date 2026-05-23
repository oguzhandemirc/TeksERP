import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string | number | null | undefined;
  hint?: string;
  icon?: LucideIcon;
  /** "ok" | "warn" | "bad" — sağ üst köşedeki renkli tepe. */
  tone?: "neutral" | "ok" | "warn" | "bad";
  isLoading?: boolean;
}

const TONE_BAR: Record<NonNullable<Props["tone"]>, string> = {
  neutral: "bg-muted",
  ok: "bg-emerald-500/70",
  warn: "bg-amber-500/70",
  bad: "bg-red-500/70",
};

/** KPI kart — başlık + büyük sayı + opsiyonel hint. */
export function MetricCard({ label, value, hint, icon: Icon, tone = "neutral", isLoading }: Props) {
  const display = value === null || value === undefined || value === "" ? "—" : value;
  return (
    <Card className="relative overflow-hidden p-4">
      <div className={cn("absolute inset-x-0 top-0 h-0.5", TONE_BAR[tone])} />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon ? <Icon className="h-4 w-4 text-muted-foreground" /> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {isLoading ? <span className="text-muted-foreground/40">...</span> : display}
      </div>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

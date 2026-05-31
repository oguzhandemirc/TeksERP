import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "@/components/motion";
import { fadeInUp, easeOut } from "@/lib/motion";

interface Props {
  label: string;
  value: string | number | null | undefined;
  hint?: string;
  icon?: LucideIcon;
  /** "ok" | "warn" | "bad" — üst kenar + (ikon varsa) chip rengi. */
  tone?: "neutral" | "ok" | "warn" | "bad";
  isLoading?: boolean;
}

const TONE_BAR: Record<NonNullable<Props["tone"]>, string> = {
  neutral: "bg-muted",
  ok: "bg-success/80",
  warn: "bg-warning/80",
  bad: "bg-destructive/80",
};

const TONE_TEXT: Record<NonNullable<Props["tone"]>, string> = {
  neutral: "text-muted-foreground",
  ok: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
};

/** KPI kart — başlık + büyük sayı + opsiyonel hint. Nazik giriş + tonlu vurgu. */
export function MetricCard({ label, value, hint, icon: Icon, tone = "neutral", isLoading }: Props) {
  const display = value === null || value === undefined || value === "" ? "—" : value;
  return (
    <motion.div variants={fadeInUp} initial="hidden" animate="show" transition={easeOut}>
      <Card className="relative h-full overflow-hidden bg-gradient-to-br from-muted/25 to-transparent p-4">
        <div className={cn("absolute inset-x-0 top-0 h-0.5", TONE_BAR[tone])} />
        {Icon ? (
          <Icon
            aria-hidden
            className={cn(
              "pointer-events-none absolute -bottom-3 -right-2 h-16 w-16 opacity-[0.05]",
              TONE_TEXT[tone],
            )}
          />
        ) : null}
        <div className="relative flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {Icon ? (
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-current/10",
                TONE_TEXT[tone],
              )}
            >
              <Icon className="h-4 w-4" />
            </div>
          ) : null}
        </div>
        <div className="relative mt-2 text-2xl font-semibold tracking-tight tabular-nums">
          {isLoading ? (
            <span className="text-muted-foreground/40">...</span>
          ) : typeof display === "number" ? (
            <AnimatedNumber value={display} />
          ) : (
            display
          )}
        </div>
        {hint ? <p className="relative mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
      </Card>
    </motion.div>
  );
}

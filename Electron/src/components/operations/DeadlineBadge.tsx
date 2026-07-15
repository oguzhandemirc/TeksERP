import { differenceInCalendarDays, format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  deadline: string | Date | null | undefined;
  className?: string;
  /** true: tarih üstte, kalan-gün rozeti ALTINDA (dar/dikey kutular için). Varsayılan:
   *  yan yana (tablo hücreleri ve diğer satır-içi kullanımlar bunu bekler). */
  stacked?: boolean;
}

export function DeadlineBadge({ deadline, className, stacked }: Props) {
  if (!deadline) return <span className="text-muted-foreground">—</span>;

  const date = typeof deadline === "string" ? new Date(deadline) : deadline;
  const days = differenceInCalendarDays(date, new Date());
  const dateText = format(date, "dd.MM.yyyy");

  let tone = "bg-muted text-muted-foreground";
  let suffix = "";

  if (days < 0) {
    tone = "bg-destructive/15 text-destructive";
    suffix = `${Math.abs(days)} gün geçti`;
  } else if (days === 0) {
    tone = "bg-destructive/15 text-destructive";
    suffix = "bugün";
  } else if (days <= 3) {
    tone = "bg-warning/15 text-warning";
    suffix = `${days} gün kaldı`;
  } else if (days <= 7) {
    tone = "bg-info/15 text-info";
    suffix = `${days} gün kaldı`;
  } else {
    tone = "bg-muted text-muted-foreground";
    suffix = `${days} gün kaldı`;
  }

  return (
    <div
      className={cn(
        stacked ? "flex flex-col items-start gap-1" : "flex items-center gap-2",
        className,
      )}
    >
      <span className="text-xs tabular-nums">{dateText}</span>
      <Badge className={cn(tone, "border-transparent text-[10px]")}>{suffix}</Badge>
    </div>
  );
}

// Alarm sayfası başlığı (tasarım §A.7-1): tezgah + hol · sebep · canlı sayaç / hedef · kademe · kaynak.
import { BellOff, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fmtFactoryDateTime, fmtFactoryTime } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import {
  ALARM_STATE_LABEL,
  alarmElapsedMs,
  formatClock,
  isLiveAlarm,
  isPastTarget,
  isSnoozed,
  reasonText,
  sourceLabel,
  tierLabel,
} from "./alarm-format";
import type { LoomAlarmItem } from "./types";

function TierBadge({ tier, live }: { tier: number; live: boolean }) {
  return (
    <Badge variant={tier >= 2 && live ? "destructive" : "secondary"} className="whitespace-nowrap">
      {tierLabel(tier)}
    </Badge>
  );
}

export function AlarmHeaderCard({ alarm: a, now }: { alarm: LoomAlarmItem; now: number }) {
  const live = isLiveAlarm(a.state);
  const late = isPastTarget(a, now);
  return (
    <section
      className={cn(
        "rounded-xl border p-5",
        live && late ? "border-destructive/40 bg-destructive/5" : "bg-card",
      )}
      aria-label="Alarm özeti"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">{a.machine.hallName}</p>
          <h2 className="text-2xl font-bold tracking-tight">Tezgah {a.machine.code}</h2>
          <p className="text-lg font-medium">{reasonText(a)}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant={live ? "default" : "outline"}>{ALARM_STATE_LABEL[a.state] ?? a.state}</Badge>
            <TierBadge tier={a.tier} live={live} />
            <span className="text-xs text-muted-foreground">Kaynak: {sourceLabel(a.stop.source)}</span>
          </div>
        </div>
        <div className="text-right">
          <p
            data-testid="alarm-timer"
            className={cn("text-4xl font-extrabold leading-none tabular-nums", late ? "text-destructive" : "text-foreground")}
          >
            {formatClock(alarmElapsedMs(a, now))}
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {a.targetMinutes !== null ? `hedef ${a.targetMinutes} dk` : "hedef süre yok"}
            {" · "}başladı {fmtFactoryTime(a.stop.startedAt)}
          </p>
          {!live && a.closedAt && <p className="text-xs text-muted-foreground">kapandı {fmtFactoryDateTime(a.closedAt)}</p>}
        </div>
      </div>
      {(a.ackedBy || isSnoozed(a, now)) && (
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t pt-3 text-sm">
          {a.ackedBy && (
            <span className="inline-flex items-center gap-1.5">
              <UserCheck className="h-4 w-4 text-emerald-600" />
              Üstlenen: <strong>{a.ackedBy.name}</strong>
              {a.ackedAt && <span className="text-muted-foreground">({fmtFactoryTime(a.ackedAt)})</span>}
            </span>
          )}
          {isSnoozed(a, now) && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <BellOff className="h-4 w-4" />
              Susturuldu — bitiş {fmtFactoryTime(a.snoozedUntil)}{a.snoozedBy ? ` (${a.snoozedBy.name})` : ""}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

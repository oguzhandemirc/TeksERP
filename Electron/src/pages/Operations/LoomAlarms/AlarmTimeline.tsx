// Alarm zaman çizgisi (tasarım §A.7-3) — alarm DEFTERİNDEN (audit değil); saatler fabrika diliminden.
// Geri çekilen not silinmez: metni durur, üstü çizilir.
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { factoryDayKey, fmtFactoryDateTime, fmtFactoryTime } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { eventLabel } from "./alarm-format";
import { canRetractNote } from "./alarm-policy";
import type { LoomAlarmDetail, LoomAlarmTimelineEntry } from "./types";

interface Props {
  detail: LoomAlarmDetail;
  canAct: boolean;
  meId: string | null;
  onRetract: (eventId: string) => void;
  busy: boolean;
}

/** Duruşla aynı fabrika günündeyse yalnız saat; değilse tarih + saat. */
function stamp(iso: string, dayOf: string): string {
  return factoryDayKey(iso) === dayOf ? fmtFactoryTime(iso) : fmtFactoryDateTime(iso);
}

function Row({ time, title, children, muted }: { time: string; title: string; children?: React.ReactNode; muted?: boolean }) {
  return (
    <li className="relative pb-4 pl-6 last:pb-0">
      <span className={cn("absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full", muted ? "border border-dashed border-muted-foreground" : "bg-primary")} />
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="w-28 shrink-0 text-sm tabular-nums text-muted-foreground">{time}</span>
        <span className={cn("text-sm font-medium", muted && "text-muted-foreground")}>{title}</span>
      </div>
      {children && <div className="mt-1 pl-0 sm:pl-[7.75rem]">{children}</div>}
    </li>
  );
}

function EntryBody({ e, canRetract, onRetract, busy }: { e: LoomAlarmTimelineEntry; canRetract: boolean; onRetract: () => void; busy: boolean }) {
  return (
    <div className="space-y-1 text-sm">
      {e.user && <p className="text-muted-foreground">{e.user.name}</p>}
      {e.kind === "SNOOZE" && e.snoozedUntil && <p className="text-muted-foreground">bitiş {fmtFactoryTime(e.snoozedUntil)}</p>}
      {e.note && (
        <p className={cn("whitespace-pre-wrap rounded-md bg-muted/60 px-3 py-2", e.retracted && "text-muted-foreground line-through")}>
          {e.note}
        </p>
      )}
      {e.retracted && <p className="text-xs text-muted-foreground">Bu not yazanı tarafından geri çekildi.</p>}
      {canRetract && (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onRetract} disabled={busy}>
          <Undo2 className="mr-1 h-3.5 w-3.5" />
          Notu geri çek
        </Button>
      )}
    </div>
  );
}

export function AlarmTimeline({ detail, canAct, meId, onRetract, busy }: Props) {
  const { alarm, timeline, nextDueAt } = detail;
  const day = factoryDayKey(alarm.stop.startedAt);
  return (
    <ol aria-label="Zaman çizgisi">
      <Row time={stamp(alarm.stop.startedAt, day)} title="Tezgah durdu" />
      {timeline
        .filter((e) => e.kind !== "NOTE_RETRACT")
        .map((e) => (
          <Row key={e.id} time={stamp(e.at, day)} title={eventLabel(e.kind, e.tier)}>
            <EntryBody e={e} canRetract={canRetractNote(e, canAct, meId)} onRetract={() => onRetract(e.id)} busy={busy} />
          </Row>
        ))}
      {nextDueAt && <Row time={`~${stamp(nextDueAt, day)}`} title="Beklenen: patrona iletilecek (2. kademe)" muted />}
    </ol>
  );
}

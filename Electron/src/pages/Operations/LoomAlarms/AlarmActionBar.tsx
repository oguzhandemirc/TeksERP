// Alarm sayfası eylemleri (tasarım §A.7-2) — düğmeler izne ve alarmın hâline göre (`alarmButtons`).
import { useState } from "react";
import { BellOff, BellRing, ChevronDown, Hand, MonitorPlay, StickyNote, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { alarmButtons } from "./alarm-policy";
import type { LoomAlarmAccess } from "./alarm-access";
import { AlarmNoteDialog } from "./AlarmNoteDialog";
import type { LoomAlarmActions } from "./useLoomAlarmActions";
import { SNOOZE_MINUTES, type LoomAlarmItem } from "./types";

interface Props {
  alarm: LoomAlarmItem;
  access: LoomAlarmAccess;
  meId: string | null;
  now: number;
  actions: LoomAlarmActions;
  /** Tezgah Salonu izni yoksa null — düğme çizilmez. */
  onShowFloor: (() => void) | null;
}

export function AlarmActionBar({ alarm, access, meId, now, actions, onShowFloor }: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  const b = alarmButtons(alarm, access, meId, now);
  const busy = actions.isPending;
  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Alarm eylemleri">
      {b.ack && (
        <Button onClick={() => void actions.ack()} disabled={busy}>
          <UserCheck className="mr-1.5 h-4 w-4" />
          Üstlen
        </Button>
      )}
      {b.release && (
        <Button variant="outline" onClick={() => void actions.release()} disabled={busy}>
          <Hand className="mr-1.5 h-4 w-4" />
          Bırak
        </Button>
      )}
      {b.releaseOther && (
        <Button variant="outline" onClick={() => void actions.release()} disabled={busy}>
          <Hand className="mr-1.5 h-4 w-4" />
          Üstlenmeyi bırak ({alarm.ackedBy?.name})
        </Button>
      )}
      {b.snooze && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={busy}>
              <BellOff className="mr-1.5 h-4 w-4" />
              Sustur
              <ChevronDown className="ml-1 h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {SNOOZE_MINUTES.map((m) => (
              <DropdownMenuItem key={m} onSelect={() => void actions.snooze(m)}>
                {m} dakika
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {b.unsnooze && (
        <Button variant="outline" onClick={() => void actions.unsnooze()} disabled={busy}>
          <BellRing className="mr-1.5 h-4 w-4" />
          Susturmayı kaldır
        </Button>
      )}
      {b.note && (
        <Button variant="outline" onClick={() => setNoteOpen(true)} disabled={busy}>
          <StickyNote className="mr-1.5 h-4 w-4" />
          Not ekle
        </Button>
      )}
      {onShowFloor && (
        <Button variant="ghost" onClick={onShowFloor}>
          <MonitorPlay className="mr-1.5 h-4 w-4" />
          Tezgah Salonunda göster
        </Button>
      )}
      {b.snooze && (
        <p className="w-full text-xs text-muted-foreground">
          Susturma yalnız tekrar çalmayı durdurur; süre aşılırsa alarm yine üst kademeye iletilir.
        </p>
      )}
      {noteOpen && <AlarmNoteDialog onClose={() => setNoteOpen(false)} onSubmit={actions.note} pending={busy} />}
    </div>
  );
}

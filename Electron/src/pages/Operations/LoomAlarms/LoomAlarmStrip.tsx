// =============================================================================
// TEZGAH ALARMI — kırmızı şerit (üst çubuğun altında; tasarım §A.6)
// =============================================================================
// Kapatılmamış açık (üstlenilmemiş) alarmların en önceliklisi: tezgah · sebep · süre ·
// [Üstlen] [Alarmı aç] [×] + "+N". Kapatılan şerit aynı alarm/kademe için geri gelmez; yeni
// alarm ya da kademe atlaması şeridi yeniden açar. Ses + OS bildirimi `useLoomAlarmSignals`.
// FAIL-CLOSED: bayrak/izin yokken ya da sunucu "kapalı" derken hiçbir şey çizilmez, çalmaz.
// =============================================================================
import { useCallback, useMemo, useState } from "react";
import { Siren, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/auth";
import { useTabsStore } from "@/store/tabs";
import { loomAlarmPath } from "@shared/loom-alarm-notify";
import { isAlarmClosedError, useLoomAlarmAccess, useServerNow } from "./alarm-access";
import { useLoomAlarmBellQuery } from "./alarm-bell-query";
import { durationVsTarget, reasonText, tierShort } from "./alarm-format";
import { alarmTierKey, stripLeadOf } from "./alarm-signal";
import { sessionKeySet } from "./alarm-seen";
import { useLoomAlarmActions } from "./useLoomAlarmActions";
import { useLoomAlarmOpenRequests, useLoomAlarmSignals, type SignalOutputs } from "./useLoomAlarmSignals";
import { useLoomAlarmSoundPref } from "./useLoomAlarmSoundPref";
import type { LoomAlarmItem } from "./types";

function AckButton({ alarmId }: { alarmId: string }) {
  const actions = useLoomAlarmActions(alarmId);
  return (
    <Button size="sm" variant="secondary" className="h-7" disabled={actions.isPending} onClick={() => void actions.ack()}>
      Üstlen
    </Button>
  );
}

interface BodyProps {
  lead: LoomAlarmItem;
  others: number;
  now: number;
  canAct: boolean;
  onOpen: (id: string) => void;
  onDismiss: () => void;
}

function StripBody({ lead, others, now, canAct, onOpen, onDismiss }: BodyProps) {
  return (
    <div
      role="alert"
      data-testid="loom-alarm-strip"
      className="flex shrink-0 items-center gap-3 bg-destructive px-4 py-1.5 text-sm text-destructive-foreground"
    >
      <Siren className="h-4 w-4 shrink-0 animate-pulse" aria-hidden />
      <p className="min-w-0 flex-1 truncate">
        <b>{lead.machine.code}</b> · {lead.machine.hallName} · {reasonText(lead)} ·{" "}
        <span className="tabular-nums">{durationVsTarget(lead, now)}</span> · {tierShort(lead.tier)}
        {others > 0 && <span className="ml-2 rounded-full bg-black/20 px-2 py-0.5 text-xs font-semibold">+{others}</span>}
      </p>
      {canAct && <AckButton key={lead.id} alarmId={lead.id} />}
      <Button size="sm" variant="secondary" className="h-7" onClick={() => onOpen(lead.id)}>
        Alarmı aç
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-destructive-foreground hover:bg-black/15 hover:text-destructive-foreground"
        aria-label="Şeridi kapat (yeni alarm gelince yeniden açılır)"
        title="Şeridi kapat — yeni alarm ya da kademe gelince yeniden açılır"
        onClick={onDismiss}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function LoomAlarmStrip({ outputs }: { outputs?: SignalOutputs } = {}) {
  const access = useLoomAlarmAccess();
  const userId = useAuthStore((s) => s.user?.userId ?? null);
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const q = useLoomAlarmBellQuery(access.canView);
  const now = useServerNow(15_000);
  const sound = useLoomAlarmSoundPref();
  const [, rerender] = useState(0);

  const open = useCallback(
    (id: string) => {
      const path = loomAlarmPath(id);
      if (path) navigateActive(path);
    },
    [navigateActive],
  );
  useLoomAlarmOpenRequests(open);

  const closed = !access.canView || isAlarmClosedError(q.error);
  const items = closed ? undefined : q.data?.items;
  useLoomAlarmSignals({ items, userId, now, soundOn: sound.on, outputs });

  const dismissed = useMemo(() => sessionKeySet(`loomAlarm.dismissed.${userId ?? "-"}`), [userId]);
  if (!items) return null;
  const lead = stripLeadOf(items, dismissed);
  if (!lead) return null;
  const openCount = q.data?.summary.open ?? items.filter((a) => a.state === "OPEN").length;
  return (
    <StripBody
      lead={lead}
      others={Math.max(0, openCount - 1)}
      now={now}
      canAct={access.canAct}
      onOpen={open}
      onDismiss={() => {
        dismissed.addAll(items.filter((a) => a.state === "OPEN").map(alarmTierKey));
        rerender((n) => n + 1);
      }}
    />
  );
}

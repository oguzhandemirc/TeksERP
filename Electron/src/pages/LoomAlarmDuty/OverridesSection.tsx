// ② Nöbet değişiklikleri — gelecek/süren vardiyalar kaldırılabilir; bitmiş vardiyalar salt-okunur geçmiş (son 7 gün).
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtFactoryTime } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { shiftWindowLabel, splitOverrides, type PersonOption } from "./duty-model";
import { OverrideFormDialog } from "./OverrideFormDialog";
import { loomAlarmDutyService } from "./service";
import { LOOM_ALARM_DUTY_QUERY_ROOT } from "./useDutyActions";
import type { DutyOverride, DutyRef, OverrideBody } from "./types";

interface Props {
  overrides: readonly DutyOverride[];
  halls: readonly DutyRef[];
  people: readonly PersonOption[];
  busy: boolean;
  onAdd: (body: OverrideBody) => Promise<boolean>;
  onRevoke: (o: DutyOverride) => void;
}

function OverrideRow({ o, onRevoke, busy }: { o: DutyOverride; onRevoke?: () => void; busy: boolean }) {
  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2 text-sm last:border-0", !onRevoke && "text-muted-foreground")}>
      <span className="w-48 font-medium">{shiftWindowLabel(o.shiftInstance)}</span>
      <span className="w-24 tabular-nums">{fmtFactoryTime(o.shiftInstance.startsAt)} – {fmtFactoryTime(o.shiftInstance.endsAt)}</span>
      <span className="w-32">{o.station.name}</span>
      <span className="w-12">K{o.tier}</span>
      <span className="flex items-center gap-1">
        {!o.user.canViewAlarms && <AlertTriangle className="h-3 w-3 text-amber-600" aria-label="Alarmları göremez" />}
        {o.user.name}
      </span>
      {o.note && <span className="text-xs text-muted-foreground">“{o.note}”</span>}
      {onRevoke && (
        <Button type="button" size="icon" variant="ghost" className="ml-auto h-7 w-7" disabled={busy} onClick={onRevoke} aria-label="Nöbet değişikliğini kaldır">
          <X className="h-4 w-4" />
        </Button>
      )}
    </li>
  );
}

export function OverridesSection({ overrides, halls, people, busy, onAdd, onRevoke }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const windows = useQuery({
    queryKey: [LOOM_ALARM_DUTY_QUERY_ROOT, "shift-instances"],
    queryFn: () => loomAlarmDutyService.shiftInstances(),
    enabled: formOpen,
  });
  const { upcoming, past } = splitOverrides(overrides);
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">Nöbet değişiklikleri</h3>
        <Button type="button" size="sm" variant="outline" onClick={() => setFormOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Nöbet değişikliği
        </Button>
      </div>
      {upcoming.length === 0 ? (
        <p className="text-sm text-muted-foreground">Gelecek vardiyalar için nöbet değişikliği yok.</p>
      ) : (
        <ul>{upcoming.map((o) => <OverrideRow key={o.id} o={o} busy={busy} onRevoke={() => onRevoke(o)} />)}</ul>
      )}
      {past.length > 0 && (
        <>
          <h4 className="mb-1 mt-4 text-xs font-semibold text-muted-foreground">Geçmiş (son 7 gün, salt-okunur)</h4>
          <ul>{past.map((o) => <OverrideRow key={o.id} o={o} busy={busy} />)}</ul>
        </>
      )}
      {formOpen && (
        <OverrideFormDialog open onOpenChange={setFormOpen} halls={halls} windows={windows.data ?? []} people={people} busy={busy} onSubmit={onAdd} />
      )}
    </section>
  );
}

// ① Hol × vardiya sorumluları — her hücrede kademe 1 ve kademe 2 kişileri; "+" kişi seçiciyi doğrudan açar.
import { useState } from "react";
import { AlertTriangle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DUTY_TIERS, buildDutyGrid, type PersonOption } from "./duty-model";
import { OptionPickerDialog } from "./OptionPickerModal";
import type { DutyRef, DutyResponsible, DutyShiftRef, DutyTier, ResponsibleBody } from "./types";

interface Props {
  halls: readonly DutyRef[];
  shifts: readonly DutyShiftRef[];
  responsibles: readonly DutyResponsible[];
  people: readonly PersonOption[];
  busy: boolean;
  onAdd: (body: ResponsibleBody) => void;
  onRevoke: (r: DutyResponsible) => void;
}

type Slot = { stationId: string; shiftDefinitionId: string; tier: DutyTier };

function PersonChip({ r, onRevoke, busy }: { r: DutyResponsible; onRevoke: () => void; busy: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs">
      {!r.user.canViewAlarms && <AlertTriangle className="h-3 w-3 text-amber-600" aria-label="Alarmları göremez" />}
      {r.user.name}
      <button type="button" disabled={busy} onClick={onRevoke} aria-label={`${r.user.name} sorumluluğunu kaldır`} className="text-muted-foreground hover:text-destructive">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function TierLine({ tier, people, slot, busy, onPick, onRevoke }: {
  tier: DutyTier; people: DutyResponsible[]; slot: Slot; busy: boolean; onPick: (s: Slot) => void; onRevoke: (r: DutyResponsible) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-6 text-xs font-semibold text-muted-foreground">K{tier}</span>
      {people.map((r) => <PersonChip key={r.id} r={r} busy={busy} onRevoke={() => onRevoke(r)} />)}
      <Button type="button" size="icon" variant="ghost" className="h-6 w-6" disabled={busy} onClick={() => onPick(slot)} aria-label={`Kademe ${tier} sorumlusu ekle`}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function ResponsibleGrid({ halls, shifts, responsibles, people, busy, onAdd, onRevoke }: Props) {
  const [slot, setSlot] = useState<Slot | null>(null);
  const grid = buildDutyGrid(halls, shifts, responsibles);
  if (grid.rows.length === 0) return <p className="text-sm text-muted-foreground">Dokuma holü tanımlı değil (istasyon türü: Dokuma).</p>;
  if (grid.shifts.length === 0) return <p className="text-sm text-muted-foreground">Aktif vardiya tanımı yok — önce Vardiya Tanımları.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Hol</th>
            {grid.shifts.map((s) => <th key={s.id} className="py-2 pr-3 font-medium">{s.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.hall.id} className="border-b align-top last:border-0">
              <td className="py-2 pr-3 font-medium">{row.hall.name}</td>
              {row.cells.map((cell) => (
                <td key={cell.shift.id} className="space-y-1 py-2 pr-3">
                  {DUTY_TIERS.map((t) => (
                    <TierLine key={t} tier={t} people={cell.byTier[t]} busy={busy} onPick={setSlot} onRevoke={onRevoke}
                      slot={{ stationId: row.hall.id, shiftDefinitionId: cell.shift.id, tier: t }} />
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <OptionPickerDialog
        open={slot !== null}
        onOpenChange={(o) => !o && setSlot(null)}
        options={people}
        title={slot ? `Kademe ${slot.tier} sorumlusu seç` : "Sorumlu seç"}
        onPick={(userId) => slot && onAdd({ ...slot, userId })}
      />
    </div>
  );
}

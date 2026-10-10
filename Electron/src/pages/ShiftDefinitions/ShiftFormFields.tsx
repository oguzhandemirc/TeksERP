// =============================================================================
// VARDİYA FORMU ALANLARI — kod (yalnız doğuşta) · ad · başlangıç · süre · mola · günler · sıra
// =============================================================================
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WEEKDAYS } from "./types";
import type { ShiftFormState } from "./form-model";

interface Props {
  state: ShiftFormState;
  errors: Partial<Record<keyof ShiftFormState, string>>;
  isCreate: boolean;
  onChange: (patch: Partial<ShiftFormState>) => void;
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

export function ShiftFormFields({ state, errors, isCreate, onChange }: Props) {
  const toggle = (v: number) => onChange({ weekdays: state.weekdays.includes(v) ? state.weekdays.filter((d) => d !== v) : [...state.weekdays, v] });
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field id="shift-code" label="Kod (raporların anahtarı — sonradan değişmez)" error={errors.code}>
        <Input id="shift-code" value={state.code} maxLength={8} disabled={!isCreate} onChange={(e) => onChange({ code: e.target.value.toUpperCase() })} />
      </Field>
      <Field id="shift-name" label="Ad" error={errors.name}>
        <Input id="shift-name" value={state.name} maxLength={100} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      <Field id="shift-start" label="Başlangıç (SS:DD)" error={errors.start}>
        <Input id="shift-start" value={state.start} placeholder="08:00" onChange={(e) => onChange({ start: e.target.value })} />
      </Field>
      <Field id="shift-dur-h" label="Süre (saat · dakika)" error={errors.durationHours}>
        <div className="flex gap-2">
          <Input id="shift-dur-h" aria-label="Süre saat" inputMode="numeric" value={state.durationHours} onChange={(e) => onChange({ durationHours: e.target.value })} />
          <Input aria-label="Süre dakika" inputMode="numeric" value={state.durationMinutes} onChange={(e) => onChange({ durationMinutes: e.target.value })} />
        </div>
      </Field>
      <Field id="shift-break" label="Planlı mola (dk)" error={errors.breakMinutes}>
        <Input id="shift-break" inputMode="numeric" value={state.breakMinutes} onChange={(e) => onChange({ breakMinutes: e.target.value })} />
      </Field>
      <Field id="shift-sort" label="Sıra" error={errors.sortOrder}>
        <Input id="shift-sort" inputMode="numeric" value={state.sortOrder} onChange={(e) => onChange({ sortOrder: e.target.value })} />
      </Field>
      <div className="col-span-2 space-y-1">
        <Label>Günler (hiçbiri seçili değilse HER GÜN)</Label>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Haftanın günleri">
          {WEEKDAYS.map((w) => (
            <Button
              key={w.value}
              type="button"
              size="sm"
              variant={state.weekdays.includes(w.value) ? "default" : "outline"}
              className={cn("w-12")}
              aria-pressed={state.weekdays.includes(w.value)}
              onClick={() => toggle(w.value)}
            >
              {w.short}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

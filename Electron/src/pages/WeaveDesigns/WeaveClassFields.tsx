// Mekanizma + örgü seçimi — oluşturma diyaloğu ve Yapı sekmesi aynı alanı kullanır.
// Seçili mekanizmanın ne demek olduğu altında tek satır açıklama olarak durur (ⓘ'ye gerek bırakmaz).
import { Label } from "@/components/ui/label";
import { InfoPopover } from "@/components/ui/info-popover";
import {
  MECHANISM_INFO, SHED_MECHANISM_HINT, SHED_MECHANISM_LABEL, STRUCTURE_INFO,
  WEAVE_STRUCTURES, WEAVE_STRUCTURE_LABEL, type ShedMechanism, type WeaveClass, type WeaveStructure,
} from "./weave-class";
import { mechanismChoices, useEnabledMechanisms } from "./mechanism-options";

export const NATIVE_SELECT_CLASS = "h-9 w-full rounded-md border bg-background px-2 text-sm";

export function WeaveClassFields({ value, onChange, disabled, idPrefix, keep }: {
  value: WeaveClass;
  onChange: (next: WeaveClass) => void;
  disabled?: boolean;
  idPrefix: string;
  /** Kartın kayıtlı mekanizması: firma ayarında kapalı olsa da listede kalır. */
  keep?: ShedMechanism;
}) {
  const choices = mechanismChoices(useEnabledMechanisms(), keep ?? value.shedMechanism);
  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={`${idPrefix}-mech`}>Mekanizma *</Label>
          <InfoPopover desc={MECHANISM_INFO} label="Mekanizma açıklaması" />
        </div>
        <select id={`${idPrefix}-mech`} className={NATIVE_SELECT_CLASS} value={value.shedMechanism} disabled={disabled}
          onChange={(e) => onChange({ ...value, shedMechanism: e.target.value as ShedMechanism })}>
          {choices.map((m) => <option key={m} value={m}>{SHED_MECHANISM_LABEL[m]}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">{SHED_MECHANISM_HINT[value.shedMechanism]}</p>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={`${idPrefix}-struct`}>Örgü</Label>
          <InfoPopover desc={STRUCTURE_INFO} label="Örgü açıklaması" />
        </div>
        <select id={`${idPrefix}-struct`} className={NATIVE_SELECT_CLASS} value={value.weaveStructure ?? ""} disabled={disabled}
          onChange={(e) => onChange({ ...value, weaveStructure: (e.target.value || null) as WeaveStructure | null })}>
          <option value="">Belirtilmedi</option>
          {WEAVE_STRUCTURES.map((s) => <option key={s} value={s}>{WEAVE_STRUCTURE_LABEL[s]}</option>)}
        </select>
      </div>
    </>
  );
}

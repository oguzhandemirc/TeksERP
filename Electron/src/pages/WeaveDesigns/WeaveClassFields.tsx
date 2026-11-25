// Mekanizma + örgü seçimi — oluşturma diyaloğu ve Desen bilgileri sekmesi aynı alanı kullanır.
// Seçili mekanizmanın ne demek olduğu altında tek satır açıklama olarak durur. Ortak FormField + EnumSelect (#902 ekran kontrolü).
import { FormField } from "@/components/forms/FormField";
import { EnumSelect } from "@/components/forms/EnumSelect";
import {
  MECHANISM_INFO, SHED_MECHANISM_HINT, SHED_MECHANISM_LABEL, STRUCTURE_INFO,
  WEAVE_STRUCTURES, WEAVE_STRUCTURE_LABEL, type ShedMechanism, type WeaveClass, type WeaveStructure,
} from "./weave-class";
import { mechanismChoices, useEnabledMechanisms } from "./mechanism-options";

/** Yerel `<select>` görünümü — yalnız satır içi küçük seçicilerde (ör. ek çözgü sarım biçimi). */
export const NATIVE_SELECT_CLASS = "h-9 w-full rounded-md border bg-background px-2 text-sm";
/** Radix Select boş değer taşımaz → "belirtilmedi" belirteci. */
const NONE = "NONE";

export function WeaveClassFields({ value, onChange, disabled, idPrefix, keep }: {
  value: WeaveClass;
  onChange: (next: WeaveClass) => void;
  disabled?: boolean;
  idPrefix: string;
  /** Kartın kayıtlı mekanizması: firma ayarında kapalı olsa da listede kalır. */
  keep?: ShedMechanism;
}) {
  const choices = mechanismChoices(useEnabledMechanisms(), keep ?? value.shedMechanism);
  const mechLabels = Object.fromEntries(choices.map((m) => [m, SHED_MECHANISM_LABEL[m]])) as Record<ShedMechanism, string>;
  const structLabels = { [NONE]: "Belirtilmedi", ...Object.fromEntries(WEAVE_STRUCTURES.map((s) => [s, WEAVE_STRUCTURE_LABEL[s]])) } as Record<WeaveStructure | typeof NONE, string>;
  return (
    <>
      <FormField label="Mekanizma" htmlFor={`${idPrefix}-mech`} required info={MECHANISM_INFO} hint={SHED_MECHANISM_HINT[value.shedMechanism]}>
        <EnumSelect<ShedMechanism> id={`${idPrefix}-mech`} value={value.shedMechanism} labels={mechLabels} disabled={disabled}
          onChange={(m) => onChange({ ...value, shedMechanism: m })} />
      </FormField>
      <FormField label="Örgü" htmlFor={`${idPrefix}-struct`} info={STRUCTURE_INFO}>
        <EnumSelect<WeaveStructure | typeof NONE> id={`${idPrefix}-struct`} value={value.weaveStructure ?? NONE} labels={structLabels} disabled={disabled}
          onChange={(s) => onChange({ ...value, weaveStructure: s === NONE ? null : s })} />
      </FormField>
    </>
  );
}

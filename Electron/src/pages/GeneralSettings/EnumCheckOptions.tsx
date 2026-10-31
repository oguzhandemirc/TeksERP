// =============================================================================
// KÜME AYARI — seçenekler alt alta onay kutusu (EnumRadioOptions'ın çoklu seçim ikizi)
// =============================================================================
import { decodeEnumSet, toggleEnumSet } from "./enum-set-codec";

interface Props {
  name: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string; hint: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function EnumCheckOptions({ name, value, options, disabled, onChange }: Props) {
  const selected = decodeEnumSet(value);
  return (
    <fieldset className="w-72 shrink-0 space-y-1.5" aria-label={name}>
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer gap-2 text-sm">
          <input
            type="checkbox"
            value={o.value}
            checked={selected.includes(o.value)}
            disabled={disabled}
            onChange={() => onChange(toggleEnumSet(value, o.value, options))}
            className="mt-1"
          />
          <span>
            <span className="font-medium">{o.label}</span>
            <span className="block text-xs text-muted-foreground">{o.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

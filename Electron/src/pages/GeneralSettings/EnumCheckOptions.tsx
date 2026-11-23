// =============================================================================
// KÜME AYARI — seçenekler alt alta onay kutusu (EnumRadioOptions'ın çoklu seçim ikizi)
// =============================================================================
import { decodeEnumSet, toggleEnumSet } from "./enum-set-codec";
import { OPTION_GRID, optionTileClass } from "./EnumRadioOptions";

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
    <fieldset className={OPTION_GRID} aria-label={name}>
      {options.map((o) => (
        <label key={o.value} className={optionTileClass(selected.includes(o.value), disabled)}>
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

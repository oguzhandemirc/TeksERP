// =============================================================================
// ENUM AYARI — seçenekler alt alta, her birinin altında tek cümle (URUN-YASAM-DONGUSU §8)
// =============================================================================
// Seçeneklerin davranışı birbirinden çok farklıysa (ör. "Tükenene kadar" kart ayarları)
// açılır liste yerine bu çizilir: kullanıcı seçmeden önce her seçeneğin ne yaptığını görür.
// =============================================================================
interface Props {
  name: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string; hint: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function EnumRadioOptions({ name, value, options, disabled, onChange }: Props) {
  return (
    <fieldset className="w-72 shrink-0 space-y-1.5" aria-label={name}>
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer gap-2 text-sm">
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={disabled}
            onChange={() => onChange(o.value)}
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

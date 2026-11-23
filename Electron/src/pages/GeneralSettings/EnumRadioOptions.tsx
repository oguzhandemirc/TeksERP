// =============================================================================
// ENUM AYARI — seçenekler ızgarada kutucuk, her birinin altında tek cümle (URUN-YASAM-DONGUSU §8)
// =============================================================================
// Seçeneklerin davranışı birbirinden çok farklıysa (ör. "Tükenene kadar" kart ayarları)
// açılır liste yerine bu çizilir: kullanıcı seçmeden önce her seçeneğin ne yaptığını görür.
// Başlığın ALTINDA yatay ızgara (dar sütuna sıkışıp 4–5 satıra kırılmaz; denetim O28).
// =============================================================================
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string; hint: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/** Seçenek ızgarası — radyo ve onay kutusu ikizinin ortak kabı. */
export const OPTION_GRID = "grid max-w-3xl gap-2 sm:grid-cols-2 lg:grid-cols-3";

export function optionTileClass(selected: boolean, disabled?: boolean): string {
  return cn(
    "flex cursor-pointer gap-2 rounded-lg border p-2.5 text-sm transition-colors",
    selected ? "border-primary/60 bg-primary/5" : "border-input hover:bg-muted/50",
    disabled && "cursor-not-allowed opacity-60",
  );
}

export function EnumRadioOptions({ name, value, options, disabled, onChange }: Props) {
  return (
    <fieldset className={OPTION_GRID} aria-label={name}>
      {options.map((o) => (
        <label key={o.value} className={optionTileClass(value === o.value, disabled)}>
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

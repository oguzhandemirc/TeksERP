import { Button } from "@/components/ui/button";
import type { GramajOption } from "@/lib/kursun-gramaj";

interface Props {
  options: readonly GramajOption[];
  /** Seçili değer kimliği; `null` = "boş" seçeneği (hedef yok / bilinmiyor). */
  value: string | null;
  onChange: (valueId: string | null) => void;
  /** Boş seçeneğin metni ("Hedef yok" · "Bilinmiyor"). */
  emptyLabel: string;
  disabled?: boolean;
}

/**
 * Gramaj seçimi — birkaç değer (25/50/100 gr) olduğu için açılır liste yerine doğrudan
 * düğme dizisi (UI tercihi: combobox yok). Düğmeler sarılır; sabit genişlik yok.
 */
export function GramajChoiceButtons({ options, value, onChange, emptyLabel, disabled }: Props) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      <Button
        type="button"
        role="radio"
        aria-checked={value === null}
        variant={value === null ? "default" : "outline"}
        disabled={disabled}
        onClick={() => onChange(null)}
      >
        {emptyLabel}
      </Button>
      {options.map((o) => (
        <Button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          variant={value === o.id ? "default" : "outline"}
          disabled={disabled}
          onClick={() => onChange(o.id)}
        >
          {o.name}
        </Button>
      ))}
    </div>
  );
}

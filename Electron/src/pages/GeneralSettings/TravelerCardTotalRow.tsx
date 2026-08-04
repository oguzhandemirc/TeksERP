import { Checkbox } from "@/components/ui/checkbox";
import type {
  TravelerCardFieldSize,
  TravelerCardFontWeight,
  TravelerCardSpecField,
} from "@/services/featureFlagService";

const SIZE_OPTS: { value: TravelerCardFieldSize; label: string }[] = [
  { value: "sm", label: "Küçük (sm)" },
  { value: "md", label: "Orta (md)" },
  { value: "lg", label: "Büyük (lg)" },
];
const WEIGHT_OPTS: { value: TravelerCardFontWeight; label: string }[] = [
  { value: "light", label: "İnce" },
  { value: "normal", label: "Normal" },
  { value: "bold", label: "Kalın" },
];
const SELECT_CLS =
  "h-7 rounded-md border border-input bg-background px-1.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

/**
 * Tablo alt-toplam satırı ayarı (göster + boyut + kalınlık). Refakat kartında
 * İKİ tablo bunu kullanıyor (bağlı siparişler, partiler) — JSX'i kopyalamak
 * yerine tek bileşen: birinin davranışı değişince öteki sessizce ayrışmasın.
 */
export function TravelerCardTotalRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: TravelerCardSpecField;
  disabled: boolean;
  onChange: (patch: Partial<TravelerCardSpecField>) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
        <Checkbox
          checked={value.show}
          disabled={disabled}
          onCheckedChange={(v) => onChange({ show: v === true })}
        />
        {label}
      </label>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Boyut
        <select
          value={value.size}
          disabled={disabled || !value.show}
          onChange={(e) => onChange({ size: e.target.value as TravelerCardFieldSize })}
          className={SELECT_CLS}
        >
          {SIZE_OPTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        Kalınlık
        <select
          value={value.weight}
          disabled={disabled || !value.show}
          onChange={(e) => onChange({ weight: e.target.value as TravelerCardFontWeight })}
          className={SELECT_CLS}
        >
          {WEIGHT_OPTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

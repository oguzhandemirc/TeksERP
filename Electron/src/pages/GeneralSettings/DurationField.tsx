import { useEffect, useState, type ReactNode } from "react";
import { Clock } from "lucide-react";
import { hoursPresetsUpTo, minutesToLabel } from "@/lib/duration";

const INPUT_CLASS =
  "flex h-9 w-28 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const PRESET_CLASS =
  "h-9 w-[9.5rem] rounded-md border border-input bg-background px-2 py-1 text-sm text-muted-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-50";

export interface DurationFieldProps {
  /** Alan başlığı (toggle yoksa üstte gösterilir; her durumda input'un aria-label'ı). */
  label: string;
  desc?: ReactNode;
  /** Kaynak-of-truth: dakika (int). Geçici boş girişte parent NaN tutabilir. */
  valueMinutes: number;
  onChangeMinutes: (m: number) => void;
  maxMinutes: number;
  minMinutes?: number;
  disabled?: boolean;
  /** Verilirse başlık yerine inline aç/kapa gelir; input yalnız `enabled` iken düzenlenir. */
  toggle?: { enabled: boolean; onToggle: (b: boolean) => void; label: string };
  error?: string;
}

/**
 * Tekdüze süre alanı — her süre DAKİKA cinsinden bir sayı input'u + yanında
 * kompakt "hazır saat" preset seçici. Toggle verilirse aç/kapa satır başında
 * inline gelir; kapalıyken input + preset devre dışı. Preset bir saat seçilince
 * dakika = saat*60 yazılır ve seçici placeholder'a döner (dakika input'u tek
 * kaynak). Preset listesi `maxMinutes`'e göre filtrelenir (hoursPresetsUpTo).
 */
export function DurationField({
  label,
  desc,
  valueMinutes,
  onChangeMinutes,
  maxMinutes,
  minMinutes = 0,
  disabled,
  toggle,
  error,
}: DurationFieldProps) {
  const inputDisabled = Boolean(disabled) || (toggle ? !toggle.enabled : false);
  const presets = hoursPresetsUpTo(maxMinutes);

  // Yerel metin — geçici boş girişe izin verir. Dışarıdan değer değişince
  // (flags yüklendi / kaydedildi) senkronlanır; yazarken (aynı sayı) dokunmaz.
  const [text, setText] = useState(String(valueMinutes));
  useEffect(() => {
    if (Number.isFinite(valueMinutes) && Number(text) !== valueMinutes) {
      setText(String(valueMinutes));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueMinutes]);

  const handleText = (raw: string) => {
    setText(raw);
    onChangeMinutes(raw.trim() === "" ? NaN : Number(raw));
  };
  const handlePreset = (hours: number) => {
    const m = hours * 60;
    setText(String(m));
    onChangeMinutes(m);
  };

  return (
    <div className="space-y-1.5">
      {toggle ? (
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={toggle.enabled}
            onChange={(e) => toggle.onToggle(e.target.checked)}
            disabled={disabled}
            className="h-5 w-5 cursor-pointer"
          />
          <span className="text-sm font-medium">{toggle.label}</span>
        </label>
      ) : (
        <div className="text-sm font-medium">{label}</div>
      )}

      {desc && <p className="text-xs text-muted-foreground">{desc}</p>}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <input
          type="number"
          inputMode="numeric"
          aria-label={label}
          value={text}
          min={minMinutes}
          max={maxMinutes}
          step={1}
          disabled={inputDisabled}
          onChange={(e) => handleText(e.target.value)}
          className={INPUT_CLASS}
        />
        <span className="text-xs text-muted-foreground">dakika</span>
        <span aria-hidden className="mx-0.5 text-muted-foreground">
          ·
        </span>
        <Clock aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        <select
          aria-label={`${label} — hazır saat`}
          value=""
          disabled={inputDisabled || presets.length === 0}
          onChange={(e) => e.target.value && handlePreset(Number(e.target.value))}
          className={PRESET_CLASS}
        >
          <option value="" disabled>
            Hazır saat…
          </option>
          {presets.map((h) => (
            <option key={h} value={h}>
              {minutesToLabel(h * 60)}
            </option>
          ))}
        </select>
      </div>

      {error && !inputDisabled && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

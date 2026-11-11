import { Check, Pipette } from "lucide-react";
import type { ReactNode } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { contrastRatio, hexToHsl, pickForeground, WHITE } from "@/lib/theme/color";
import { customColorVars, type ThemePreset } from "@/lib/theme/appearance";
import { PRESETS, type Option } from "./appearance-options";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** Tek seçimli düğme dizisi (radiogroup) — ok tuşu yerine Tab ile gezilir, seçim görünür. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  icons,
}: {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  icons?: Partial<Record<T, ReactNode>>;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-[var(--radius-control)] bg-muted p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "bg-card font-semibold text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {icons?.[o.value]}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Hazır tema örnekleri — her örnek kendi `data-preset` kapsamında `bg-primary` çizer (sabit renk yok). */
export function PresetSwatches({
  value,
  customColor,
  onPreset,
  onCustom,
}: {
  value: ThemePreset;
  customColor: string;
  onPreset: (v: ThemePreset) => void;
  onCustom: (hex: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Tema rengi" className="flex flex-wrap items-center gap-2">
      {PRESETS.map((p) => (
        <Swatch key={p.value} preset={p.value} label={p.label} active={value === p.value} onClick={() => onPreset(p.value)} />
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="radio"
            aria-checked={value === "custom"}
            aria-label="Özel renk"
            title="Özel renk"
            onClick={() => onPreset("custom")}
            data-preset="custom"
            style={customColorVars(customColor) ?? undefined}
            className={swatchClass(value === "custom")}
          >
            {value === "custom" ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Pipette className="h-3.5 w-3.5" />}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60">
          <CustomColorPicker color={customColor} onChange={onCustom} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function swatchClass(active: boolean) {
  return cn(
    "inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground ring-offset-2 ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active && "ring-2 ring-ring",
  );
}

function Swatch({ preset, label, active, onClick }: { preset: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={active} aria-label={label} title={label} onClick={onClick} data-preset={preset} className={swatchClass(active)}>
      {active && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </button>
  );
}

/** Serbest renk + hex girişi; yazı rengi kontrasta göre otomatik (beyaz ya da koyu). */
export function CustomColorPicker({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const hsl = hexToHsl(color);
  const fg = hsl ? pickForeground(hsl) : WHITE;
  const ratio = hsl ? contrastRatio(hsl, fg) : 0;
  return (
    <div className="space-y-2">
      <HexColorPicker color={color} onChange={onChange} style={{ width: "100%", height: 150 }} />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Renk kodu
        <HexColorInput
          color={color}
          onChange={onChange}
          prefixed
          aria-label="Renk kodu"
          className="h-8 flex-1 rounded-[var(--radius-control)] border border-input bg-background px-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <p className="text-[11px] text-muted-foreground" data-testid="custom-contrast">
        Düğme yazısı {fg === WHITE ? "beyaz" : "koyu"} seçildi · kontrast {ratio.toFixed(1)}:1
        {ratio < 4.5 && " — okunurluk düşük, daha koyu/açık bir ton dene"}
      </p>
    </div>
  );
}

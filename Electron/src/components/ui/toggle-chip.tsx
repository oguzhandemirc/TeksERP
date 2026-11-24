// Seçilebilir düğme (toggle chip) ve yan yana seçenek düğmeleri (2026-11-24): seçili değilken boş halka, seçilince
// ana renk + ✓. Altta gerçek checkbox/radio durur (sr-only) — RHF `register`, klavye ve erişilebilir ad bozulmaz.
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

const PILL =
  "group inline-flex min-h-9 cursor-pointer select-none items-center gap-2 rounded-full border border-input bg-background px-3.5 text-sm font-medium text-muted-foreground transition-colors " +
  "hover:border-primary/60 hover:text-foreground has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground " +
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-1 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60";

function Marks() {
  return (
    <>
      <Circle className="h-4 w-4 shrink-0 group-has-[:checked]:hidden" aria-hidden />
      <Check className="hidden h-4 w-4 shrink-0 group-has-[:checked]:inline" strokeWidth={3} aria-hidden />
    </>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/** Tek seçim düğmesi (checkbox). */
export const ToggleChip = forwardRef<HTMLInputElement, InputProps & { label: ReactNode; className?: string }>(
  ({ label, className, ...input }, ref) => (
    <label className={cn(PILL, className)}>
      <input ref={ref} type="checkbox" className="sr-only" {...input} />
      <Marks />
      <span>{label}</span>
    </label>
  ),
);
ToggleChip.displayName = "ToggleChip";

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  /** Düğmede ikinci satır (ör. fabrika ayarının bugünkü karşılığı). */
  sub?: string;
}

/** Yan yana tek seçim düğmeleri (radio grubu). */
export function ChoiceChips<T extends string>({
  name,
  options,
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  name: string;
  options: ReadonlyArray<ChoiceOption<T>>;
  value: T | null;
  onChange: (v: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label key={o.value} className={PILL}>
          <input type="radio" name={name} value={o.value} className="sr-only" checked={value === o.value} disabled={disabled} onChange={() => onChange(o.value)} />
          <Marks />
          {/* Alt metin aynı satırda: iki satırlı düğme komşularından uzun duruyordu (B18/13). */}
          <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
            <span>{o.label}</span>
            {o.sub ? <span className="text-xs font-normal opacity-80">{o.sub}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

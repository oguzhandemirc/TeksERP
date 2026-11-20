import { cn } from "@/lib/utils";
import { TYPE_HINT, TYPE_LABEL } from "./labels";
import type { TicketType } from "./types";

const TYPES: TicketType[] = ["BUG", "QUESTION", "REQUEST"];

/** Üç seçenekli tür seçimi — açılır liste yerine doğrudan düğmeler (tek tıkla seçilir). */
export function TicketTypePicker({ value, onChange, disabled }: { value: TicketType; onChange: (t: TicketType) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Talep türü" className="grid grid-cols-3 gap-2">
      {TYPES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          disabled={disabled}
          onClick={() => onChange(t)}
          className={cn(
            "rounded-md border px-3 py-2 text-left transition-colors",
            value === t ? "border-primary bg-primary/10 ring-1 ring-primary" : "hover:bg-accent/50",
          )}
        >
          <span className="block text-sm font-medium">{TYPE_LABEL[t]}</span>
          <span className="block text-[11px] leading-tight text-muted-foreground">{TYPE_HINT[t]}</span>
        </button>
      ))}
    </div>
  );
}

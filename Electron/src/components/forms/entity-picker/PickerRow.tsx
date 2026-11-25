import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Seçici satırı; `actions` (Düzenle · Örnek al) seçim düğmesinin DIŞINDA kardeş — iç içe düğme olmasın. */
export function PickerRow({
  selected,
  onClick,
  label,
  subLabel,
  leading,
  dimmed,
  actions,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  subLabel?: string | null;
  leading?: ReactNode;
  dimmed?: boolean;
  actions?: ReactNode;
}) {
  return (
    <li className={cn("flex items-center", selected && "bg-primary/10")}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50",
          selected && "hover:bg-primary/15",
        )}
      >
        {leading}
        <div className="min-w-0 flex-1">
          <div className={cn("truncate", dimmed && !selected && "italic text-muted-foreground")}>
            {label}
          </div>
          {subLabel && (
            <div className="truncate text-[11px] text-muted-foreground">{subLabel}</div>
          )}
        </div>
        {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
      </button>
      {actions}
    </li>
  );
}

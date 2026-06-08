import { Check, Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Renk seçici modalında tek satır. Hem "müşteri renkleri" (highlighted + yıldız)
 * hem "tüm renkler" bölümünde kullanılır.
 */
export function ColorRow({
  selected,
  onClick,
  name,
  code,
  hex,
  subLabel,
  highlighted,
  dimmed,
}: {
  selected: boolean;
  onClick: () => void;
  name: string;
  code?: string;
  hex?: string | null;
  /** İkincil küçük satır — örn. "bizde: Mavi" (alias farklıysa). */
  subLabel?: string | null;
  /** Müşteriye atanmış renk — vurgulu arka plan + yıldız. */
  highlighted?: boolean;
  /** "Renksiz" gibi pasif görünüm. */
  dimmed?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50",
          highlighted && "bg-amber-50 hover:bg-amber-100/70 dark:bg-amber-950/30",
          selected && "bg-primary/10 hover:bg-primary/15",
        )}
      >
        <span
          className={cn("h-4 w-4 shrink-0 rounded-sm border", !hex && "bg-muted")}
          style={hex ? { backgroundColor: hex } : undefined}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {highlighted && (
              <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500" />
            )}
            <span
              className={cn(
                "truncate",
                dimmed && !selected && "italic text-muted-foreground",
              )}
            >
              {name}
            </span>
          </div>
          {subLabel ? (
            <div className="truncate text-[11px] text-muted-foreground">{subLabel}</div>
          ) : (
            code && (
              <div className="truncate text-[11px] text-muted-foreground">{code}</div>
            )
          )}
        </div>
        {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
      </button>
    </li>
  );
}

import { Check, Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Renk seçici grid hücresi — kompakt yatay satır: solda küçük kare swatch +
 * okunaklı renk adı. Müşteri renkleri (highlighted) amber çerçeve + ★ ile ayrılır;
 * seçili hücre primary halka alır. (Renk kodu gösterilmez — ad öne çıkar.)
 */
export function ColorSwatchCard({
  selected,
  onClick,
  name,
  hex,
  highlighted,
}: {
  selected: boolean;
  onClick: () => void;
  name: string;
  hex?: string | null;
  /** Müşteriye atanmış renk — vurgulu görünüm. */
  highlighted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={name}
      className={cn(
        "group flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors hover:border-primary/50 hover:bg-accent/40",
        highlighted &&
          "border-amber-300/70 bg-amber-50/60 dark:border-amber-700/50 dark:bg-amber-950/20",
        selected && "border-primary ring-1 ring-primary",
      )}
    >
      <span
        className={cn("h-5 w-5 shrink-0 rounded-sm border", !hex && "bg-muted")}
        style={hex ? { backgroundColor: hex } : undefined}
      />
      {highlighted && (
        <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" />
      )}
      <span className="truncate text-sm font-medium">{name}</span>
      {selected && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
    </button>
  );
}

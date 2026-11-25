import type { ReactNode } from "react";
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
  actions,
}: {
  selected: boolean;
  onClick: () => void;
  name: string;
  hex?: string | null;
  /** Müşteriye atanmış renk — vurgulu görünüm. */
  highlighted?: boolean;
  /** Düzenle · Örnek al — hücrenin sağında, üzerine gelince/odakta görünür (iç içe düğme olmasın diye kardeş). */
  actions?: ReactNode;
}) {
  const card = (
    <button
      type="button"
      onClick={onClick}
      title={name}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors hover:border-primary/50 hover:bg-accent/40",
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
  if (!actions) return card;
  return (
    <div className="group/cell relative">
      {card}
      <div className="absolute inset-y-0 right-0 flex items-center rounded-r-md bg-card/95 opacity-0 transition-opacity focus-within:opacity-100 group-hover/cell:opacity-100">
        {actions}
      </div>
    </div>
  );
}

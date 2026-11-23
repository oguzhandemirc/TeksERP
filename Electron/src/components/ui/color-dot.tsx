import { cn } from "@/lib/utils";

/** Tanım listelerinde kaydın rengi — adın önünde küçük nokta. Renk yoksa hiçbir şey çizilmez
 *  (boş kesikli kare "eksik veri" gibi okunuyordu; ayrı başlıksız sütun da kalktı). */
export function ColorDot({ color, className }: { color?: string | null; className?: string }) {
  if (!color) return null;
  return (
    <span
      aria-hidden
      className={cn("inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-border", className)}
      style={{ backgroundColor: color }}
    />
  );
}

/** Ad hücresi: renk noktası + ad (renk yoksa yalnız ad). */
export function NameWithColor({ name, color }: { name: string; color?: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ColorDot color={color} />
      <span className="min-w-0 truncate">{name}</span>
    </span>
  );
}

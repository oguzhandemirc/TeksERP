// Kilitli müşteri rozeti (D4-I3) — liste satırlarında; metin SUNUCUDAN (`holdText`, tablet çipiyle aynı kaynak).
// Eski backend alanı göndermez → rozet çizilmez.
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Props {
  view?: { held: boolean; holdText: string | null } | null;
  /** Cari Hesaplar satırı gibi metni olmayan yerde kısa başlık. */
  title?: string;
}

export function CariHoldBadge({ view, title }: Props) {
  if (!view?.held) return null;
  const text = view.holdText ?? title ?? "Cari kilitli";
  return (
    <Badge variant="outline" title={text} aria-label={text} className="ml-2 gap-1 border-amber-500 bg-amber-50 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <Lock className="h-3 w-3" aria-hidden />
      Kilitli
    </Badge>
  );
}

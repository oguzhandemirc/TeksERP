import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Hub gövdesinin bayrak-bekleme iskeleti. Modüllü karolar bayrak sorgusu bitmeden
 * "gizli" değil "bilinmiyor"dur: karo kümesini süzüp çizmek, sorgu dolunca karoların
 * BELİRMESİ demektir (titreme). Bayraklar gelene dek hub gövdesi yerine bu çizilir —
 * `flagsReady` (ctx) tek karar noktası, route kapısıyla aynı kabul.
 */
export function HubSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div data-testid="hub-iskelet" className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-[92px] w-full" />
      ))}
    </div>
  );
}

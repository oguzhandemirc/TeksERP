// Fiyat kaynağı rozeti — ad ve açıklama `SOURCE_BADGE`ten (tek kaynak).
import { cn } from "@/lib/utils";
import type { ServicePriceSource } from "./service";
import { SOURCE_BADGE } from "./servicePrices";

export function SourceBadge({ source, formula }: { source: ServicePriceSource; formula?: string | null }) {
  const b = SOURCE_BADGE[source];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium",
        b.className,
      )}
      title={formula ? `${b.hint} — ${formula}` : b.hint}
    >
      {b.label}
    </span>
  );
}

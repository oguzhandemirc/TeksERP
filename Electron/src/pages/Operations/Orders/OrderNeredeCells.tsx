import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { neredeTone, sevkText } from "./order-nerede";
import type { Order } from "./types";

/**
 * "Nerede?" hücresi — sunucunun cümlesi renkli rozette, termin geçtiyse yanında
 * kırmızı ek rozet. Cümle panelde KURULMAZ (NEREDE-SOZLESME §1); eski sunucu "—".
 */
export function NeredeCell({ order }: { order: Pick<Order, "nerede"> }) {
  const n = order.nerede;
  if (!n) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <StatusBadge
        status={n.text}
        tones={{ [n.text]: neredeTone(n.tone) }}
        className="whitespace-normal text-left"
      />
      {n.overdueText && (
        <Badge variant="destructive" className="text-[10px]" data-testid="nerede-overdue">
          {n.overdueText}
        </Badge>
      )}
    </div>
  );
}

/** "Sevk" hücresi — sunucunun cümlesi (BRÜT sevk); eski sunucu "—". */
export function SevkCell({ order }: { order: Pick<Order, "sevk"> }) {
  if (!order.sevk) return <span className="text-muted-foreground text-xs">—</span>;
  return <span className="text-xs">{sevkText(order)}</span>;
}

import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { neredeTone } from "./order-nerede";
import { orderSevkText, orderSevkTone } from "./order-cell-text";
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

/** "Sevk durumu" hücresi — günlük dil, kısmi sevkte miktar parantezde (`orderSevkText`). */
export function SevkCell({ order }: { order: Pick<Order, "status" | "sevk"> }) {
  const text = orderSevkText(order);
  return (
    <StatusBadge
      status={text}
      tones={{ [text]: orderSevkTone(order) }}
      className="whitespace-normal text-left"
    />
  );
}

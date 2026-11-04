import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { OVERDUE_TEXT, orderShipView, orderWhereView } from "./order-where-text";
import type { Order } from "./types";

/**
 * "Nerede?" hücresi — renkli rozet + termin geçtiyse kırmızı ek rozet. Metin
 * `orderWhereView`dan (Excel/PDF ile aynı); alan yoksa (üretim kapalı / eski backend) "—".
 */
export function WhereCell({ order }: { order: Pick<Order, "nerede" | "manualClosedById"> }) {
  const view = orderWhereView(order);
  if (!view) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <StatusBadge status={view.text} tones={{ [view.text]: view.tone }} className="whitespace-normal text-left" />
      {view.overdue && (
        <Badge variant="destructive" className="text-[10px]" data-testid="where-overdue">
          {OVERDUE_TEXT}
        </Badge>
      )}
    </div>
  );
}

/** "Sevk durumu" hücresi — günlük dil rozeti, miktar parantezde (Excel/PDF ile aynı metin). */
export function ShipCell({ order }: { order: Pick<Order, "status" | "shippedQty" | "manualClosedById" | "lines"> }) {
  const view = orderShipView(order);
  return (
    <StatusBadge status={view.text} tones={{ [view.text]: view.tone }} className="whitespace-normal text-left" />
  );
}

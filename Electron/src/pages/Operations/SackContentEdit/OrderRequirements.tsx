import { ClipboardList } from "lucide-react";
import { safeFormat } from "@/lib/format";
import type { ShipmentDetailOrder } from "./types";

const m = (n: number) => `${Math.round(Number(n))}m`;

/**
 * Paketleme workspace'inde sipariş(ler)in "müşteri ne istiyor" özeti — sayfada
 * sabit, belirgin panel (modal/inline değil). detail.orders'tan beslenir; her
 * kalemin Ürün·Renk·En + İstenen / Açık / Bu sevk metrajı. Açık = henüz sevk
 * edilmemiş (istenen − sevk); Bu sevk = bu sevkiyata okutulmuş gerçek metraj.
 */
export function OrderRequirements({ orders }: { orders: ShipmentDetailOrder[] }) {
  if (orders.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-lg border border-primary/30 bg-card">
      <div className="flex items-center gap-1.5 border-b bg-primary/5 px-4 py-2 text-sm font-semibold text-primary">
        <ClipboardList className="h-4 w-4" /> Müşteri Ne İstiyor
        {orders.length > 1 ? (
          <span className="ml-1 text-xs font-normal text-muted-foreground">({orders.length} sipariş)</span>
        ) : null}
      </div>
      <div className="max-h-[34vh] divide-y overflow-auto">
        {orders.map((o) => (
          <div key={o.id} className="p-3">
            <div className="mb-1.5 flex items-center gap-2 text-xs">
              <span className="font-mono font-semibold">{o.orderNumber}</span>
              {o.deadline ? (
                <span className="text-muted-foreground">termin {safeFormat(o.deadline, "dd.MM.yyyy")}</span>
              ) : null}
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1 font-medium">Ürün · Renk · En</th>
                  <th className="py-1 text-right font-medium">İstenen</th>
                  <th className="py-1 text-right font-medium">Açık</th>
                  <th className="py-1 text-right font-medium">Bu sevk</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.lineId} className="border-t">
                    <td className="py-1 pr-2">
                      {l.customerItemName ?? l.item.name}
                      {l.color ? ` · ${l.customerColorName ?? l.color.name}` : ""}
                      {l.width != null ? ` · ${l.width}cm` : ""}
                    </td>
                    <td className="py-1 text-right tabular-nums">{m(l.requested)}</td>
                    <td className="py-1 text-right font-medium tabular-nums">{m(l.openQty)}</td>
                    <td className="py-1 text-right font-semibold tabular-nums text-primary">{m(l.thisShipment)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}

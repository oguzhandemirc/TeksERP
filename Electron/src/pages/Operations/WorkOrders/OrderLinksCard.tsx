import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { formatNumber } from "@/lib/format";
import type { WorkOrder } from "./types";

/**
 * İş emrine bağlı sipariş(ler) — sipariş no + müşteri + kalemler (ürün/renk/
 * özellik/en/boy). Stoğa üretimde bilgi notu. Slide-over + tam sayfada ortak.
 */
export function OrderLinksCard({ wo }: { wo: WorkOrder }) {
  const orderGroups = useMemo(() => {
    const links = wo.orderLinks ?? [];
    const map = new Map<string, typeof links>();
    for (const link of links) {
      const orderId = link.orderLine?.order?.id ?? `__no_order_${link.orderLineId}`;
      const arr = map.get(orderId) ?? [];
      arr.push(link);
      map.set(orderId, arr);
    }
    return [...map.entries()].map(([orderId, ls]) => ({
      orderId,
      order: ls[0]?.orderLine?.order,
      links: ls,
    }));
  }, [wo.orderLinks]);

  if (wo.type === "STOCK_PRODUCTION" && orderGroups.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        Stoğa üretim — siparişe bağlı değil.
      </div>
    );
  }
  if (orderGroups.length === 0) return null;

  return (
    <div className="space-y-2">
      {orderGroups.map(({ orderId, order, links }) => (
        <Card key={orderId}>
          <CardContent className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-mono text-xs font-semibold">{order?.orderNumber ?? "—"}</span>
                {order?.customer && <span className="truncate text-sm">{order.customer.name}</span>}
              </div>
              {order?.deadline && <DeadlineBadge deadline={order.deadline} />}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Kalemler ({links.length})
            </div>
            <ul className="divide-y rounded-md border">
              {links.map((link) => {
                const ol = link.orderLine;
                return (
                  <li
                    key={link.orderLineId}
                    className="flex flex-wrap items-center justify-between gap-2 p-2 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-medium">{ol?.item?.name ?? "—"}</span>
                      {ol?.color && (
                        <span className="ml-1.5 inline-flex items-center gap-1">
                          {ol.color.hex && (
                            <span
                              className="h-2.5 w-2.5 rounded-full ring-1 ring-border"
                              style={{ backgroundColor: ol.color.hex }}
                            />
                          )}
                          <span className="text-muted-foreground">{ol.color.name}</span>
                        </span>
                      )}
                      {ol?.requiredProperties && ol.requiredProperties.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {ol.requiredProperties.map((rp) => (
                            <Badge key={rp.propertyId} variant="muted" className="text-[9px]">
                              {rp.property.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {ol?.width != null && (
                        <Badge variant="outline" className="font-normal">
                          En: {ol.width} cm
                        </Badge>
                      )}
                      {ol?.quantity != null && (
                        <Badge variant="outline" className="font-normal">
                          Boy: {formatNumber(ol.quantity, 0)} m
                        </Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

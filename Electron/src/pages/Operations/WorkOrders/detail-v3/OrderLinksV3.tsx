import { useMemo } from "react";
import { safeFormat, formatNumber } from "@/lib/format";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { lineOpenMeasured } from "../order-fulfillment";
import type { WorkOrder } from "../types";

/**
 * v3 kurumsal bağlı sipariş(ler) — `OrderLinksCard` ile AYNI içerik (sipariş no +
 * müşteri + termin + kalemler: kumaş/renk/en/boy/özellik + Sevk/Açık), v3 token'lı
 * `.card`/`.chip`/`.tag`/`.swatch` diliyle. Yan panelde shadcn kartları yerine
 * kullanılır ki panel tam sayfayla tutarlı görünsün.
 */
export function OrderLinksV3({ wo }: { wo: WorkOrder }) {
  const openTarget = useOpenTarget();
  const groups = useMemo(() => {
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

  if (wo.type === "STOCK_PRODUCTION" && groups.length === 0) {
    return <div className="card emptybox">Stoğa üretim — siparişe bağlı değil.</div>;
  }
  if (groups.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {groups.map(({ orderId, order, links }) => (
        <div key={orderId} className="card info" style={{ padding: "12px 14px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              borderBottom: "1px solid var(--border)",
              paddingBottom: "8px",
            }}
          >
            {orderId.startsWith("__no_order_") ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                <span
                  className="mono"
                  style={{ fontSize: "12px", fontWeight: 700, color: "var(--accent-ink)" }}
                >
                  {order?.orderNumber ?? "—"}
                </span>
                {order?.customer && <span style={{ fontWeight: 600 }}>{order.customer.name}</span>}
              </div>
            ) : (
              <button
                type="button"
                title="Siparişi aç"
                onClick={(e) => openTarget(`/operations/orders?focus=${orderId}`, e)}
                onAuxClick={(e) => {
                  if (e.button !== 1) return;
                  e.preventDefault();
                  openTarget(`/operations/orders?focus=${orderId}`, e);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  minWidth: 0,
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  font: "inherit",
                  textAlign: "left",
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "var(--accent-ink)",
                    textDecoration: "underline",
                    textUnderlineOffset: "2px",
                  }}
                >
                  {order?.orderNumber ?? "—"}
                </span>
                {order?.customer && <span style={{ fontWeight: 600 }}>{order.customer.name}</span>}
              </button>
            )}
            {order?.deadline && (
              <span className="pill neutral sm num">{safeFormat(order.deadline, "dd.MM.yyyy")}</span>
            )}
          </div>

          <div style={{ marginTop: "9px", display: "flex", flexDirection: "column", gap: "9px" }}>
            {links.map((link) => {
              const ol = link.orderLine;
              // KG/ADET satırda açık metraj ölçülmez (null) — "ölçülmüyor" basılır.
              const open = ol ? lineOpenMeasured(ol) : 0;
              return (
                <div
                  key={link.orderLineId}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 550 }}>{ol?.item?.name ?? "—"}</span>
                    {ol?.color && (
                      <span className="swatch" style={{ marginLeft: "7px", color: "var(--muted)" }}>
                        {ol.color.hex && <i style={{ background: ol.color.hex }} />}
                        {ol.color.name}
                      </span>
                    )}
                    {ol?.width != null && (
                      <span className="tag" style={{ marginLeft: "7px" }}>
                        En {formatNumber(ol.width, 1)} cm
                      </span>
                    )}
                    {ol?.quantity != null && (
                      <span className="tag" style={{ marginLeft: "6px" }}>
                        Boy {formatNumber(ol.quantity, 1)} m
                      </span>
                    )}
                    {ol?.requiredProperties && ol.requiredProperties.length > 0 && (
                      <div className="props">
                        {ol.requiredProperties.map((rp) => (
                          <span key={rp.propertyId} className="tag">
                            {rp.property.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {ol && order?.status !== "CANCELLED" && (
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      <span className="chip ok num">Sevk {formatNumber(ol.shippedQty ?? 0, 1)}</span>
                      <span className="chip bad num">
                        {open === null ? "Açık ölçülmüyor" : `Açık ${formatNumber(open, 1)}`}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

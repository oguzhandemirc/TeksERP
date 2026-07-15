import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { safeFormat, formatNumber } from "@/lib/format";
import type { WorkOrder } from "../types";
import type { LinkedFulfillment } from "../order-fulfillment";
import { OrdersDetailModal, type OrderDetailRow } from "./OrdersDetailModal";

/**
 * v3 dört-kutu özeti: Üretim İlerlemesi (çıkan/giren + bar), Termin (tarih +
 * geri-sayım çipi), Sipariş Toplam (talep + Sevk/Açık), Siparişler (adet +
 * müşteri önizleme + ⓘ → detay modalı). Siparişsiz WO'da son iki kutu boş durumu.
 */
export function WorkOrderKpis({
  wo,
  fulfill,
  hasOrders,
}: {
  wo: WorkOrder;
  fulfill: LinkedFulfillment;
  hasOrders: boolean;
}) {
  const [ordersOpen, setOrdersOpen] = useState(false);
  const input = wo.inputRolls?.totalMeters ?? 0;
  const output = wo.producedRolls?.warehouse.totalMeters ?? 0;
  const inCount = wo.inputRolls?.count ?? 0;
  const pct = input > 0 ? Math.min(100, Math.round((output / input) * 100)) : 0;
  const term = terminInfo(wo.plannedEndDate, wo.status);
  const rows = orderRows(wo.orderLinks ?? []);
  const customerNames = [...new Set(rows.map((r) => r.customer))];

  return (
    <>
      <div className="kpis">
        <div className="kpi">
          <span className="lab">Üretim İlerlemesi</span>
          <div className="big num">%{pct}</div>
          <div className="bar">
            <span style={{ width: `${Math.max(2, pct)}%` }} />
          </div>
          <div className="kpi-sub">
            <span>
              Çıkan <b className="num">{formatNumber(output, 0)} m</b>
            </span>
            <span>
              Giren <b className="num">{formatNumber(input, 0)} m</b>
              {inCount > 0 && (
                <>
                  {" · "}
                  <b className="num">{inCount} top</b>
                </>
              )}
            </span>
          </div>
        </div>

        <div className="kpi">
          <span className="lab">Termin</span>
          <div className="term">
            <span className="d num">
              {wo.plannedEndDate ? safeFormat(wo.plannedEndDate, "dd.MM.yyyy") : "—"}
            </span>
          </div>
          <span className={`chip ${term.cls} num`} style={{ alignSelf: "flex-start" }}>
            {term.label}
          </span>
        </div>

        <div className="kpi">
          <span className="lab">Sipariş Toplam</span>
          {hasOrders ? (
            <>
              <div className="big num">
                {formatNumber(fulfill.requested, 0)}
                <small>m</small>
              </div>
              <div className="kpi-sub" style={{ gap: "6px" }}>
                <span className="chip ok num">Sevk {formatNumber(fulfill.shipped, 0)}</span>
                <span className="chip bad num">Açık {formatNumber(fulfill.open, 0)}</span>
              </div>
            </>
          ) : (
            <div className="big" style={{ fontSize: "16px", color: "var(--muted)" }}>
              Stok üretimi
            </div>
          )}
        </div>

        <div className="kpi">
          <div className="kpi-orderhead">
            <span className="lab">Siparişler</span>
            {hasOrders && (
              <button type="button" className="orders-btn" onClick={() => setOrdersOpen(true)}>
                Siparişleri Gör
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {hasOrders ? (
            <>
              <div className="big num">
                {rows.length}
                <small>sipariş</small>
              </div>
              <div className="ord-cust" title={customerNames.join(" · ")}>
                {customerNames.map((c, i) => (
                  <span key={c}>
                    {i > 0 && <span className="sep">•</span>}
                    {c}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="big" style={{ fontSize: "16px", color: "var(--muted)" }}>
              —
            </div>
          )}
        </div>
      </div>

      <OrdersDetailModal open={ordersOpen} onOpenChange={setOrdersOpen} rows={rows} />
    </>
  );
}

/** Bağlı sipariş kalemleri → müşteri/no/şube + talep/sevk (distinct orderLineId). */
function orderRows(links: NonNullable<WorkOrder["orderLinks"]>): OrderDetailRow[] {
  const seen = new Set<string>();
  const out: OrderDetailRow[] = [];
  for (const l of links) {
    if (seen.has(l.orderLineId) || !l.orderLine) continue;
    seen.add(l.orderLineId);
    const ol = l.orderLine;
    out.push({
      id: l.orderLineId,
      customer: ol.order?.customer?.name ?? "—",
      orderNumber: ol.order?.orderNumber ?? "—",
      branch: ol.order?.branch?.name ?? "—",
      qty: Number(ol.quantity ?? 0),
      shipped: Number(ol.shippedQty ?? 0),
    });
  }
  return out;
}

function terminInfo(
  deadline: string | null,
  status: string,
): { label: string; cls: "dim" | "ok" | "warn" | "bad" } {
  if (status === "COMPLETED") return { label: "Tamamlandı", cls: "ok" };
  if (!deadline) return { label: "Termin yok", cls: "dim" };
  const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: `${Math.abs(days)} gün gecikme`, cls: "bad" };
  if (days === 0) return { label: "Bugün", cls: "warn" };
  return { label: `${days} gün kaldı`, cls: "dim" };
}

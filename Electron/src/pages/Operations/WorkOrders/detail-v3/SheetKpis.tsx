import { safeFormat, formatNumber } from "@/lib/format";
import type { WorkOrder } from "../types";
import type { LinkedFulfillment } from "../order-fulfillment";

/**
 * Yan panel (slide-over) KPI satırı — v3 kurumsal `.kpi` kartlarıyla, ama
 * SHEET'in mevcut İÇERİĞİYLE: Sipariş Toplam · Üretime Giren · En · Termin +
 * (hedef varsa) Üretim İlerlemesi. Tam sayfadaki WorkOrderKpis'ten farkı içerik
 * setidir (burada En + Üretime Giren ayrı kutu); görsel dil aynıdır.
 */
export function SheetKpis({
  wo,
  fulfill,
  hasOrders,
}: {
  wo: WorkOrder;
  fulfill: LinkedFulfillment;
  hasOrders: boolean;
}) {
  const input = wo.inputRolls?.totalMeters ?? 0;
  const inCount = wo.inputRolls?.count ?? 0;
  const hasTarget = wo.targetQuantity != null && wo.targetQuantity > 0 && !!wo.producedRolls;
  const target = Number(wo.targetQuantity ?? 0);
  const wh = wo.producedRolls?.warehouse.totalMeters ?? 0;
  const pct = hasTarget && target > 0 ? (Number(wh) / target) * 100 : 0;
  const done = pct >= 100;
  const term = terminInfo(wo.plannedEndDate, wo.status);

  return (
    <>
      <div className="kpis">
        {hasOrders && (
          <div className="kpi">
            <span className="lab">Sipariş Toplam</span>
            <div className="big num">
              {formatNumber(fulfill.requested, 0)}
              <small>m</small>
            </div>
            <div className="kpi-sub" style={{ gap: "6px" }}>
              <span className="chip ok num">Sevk {formatNumber(fulfill.shipped, 0)}</span>
              <span className="chip bad num">Açık {formatNumber(fulfill.open, 0)}</span>
            </div>
          </div>
        )}

        <div className="kpi">
          <span className="lab">Üretime Giren</span>
          <div className="big num">
            {formatNumber(input, 0)}
            <small>m</small>
          </div>
          {inCount > 0 && (
            <div className="kpi-sub">
              <span>
                <b className="num">{inCount} top</b>
              </span>
            </div>
          )}
        </div>

        <div className="kpi">
          <span className="lab">En</span>
          <div className="big num">
            {wo.width != null ? (
              <>
                {wo.width}
                <small>cm</small>
              </>
            ) : (
              "—"
            )}
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
      </div>

      {hasTarget && (
        <div className="kpi" style={{ marginTop: "10px" }}>
          <div className="kpi-orderhead">
            <span className="lab">Üretim İlerlemesi · bitmiş depo</span>
            <span className={`chip ${done ? "ok" : "dim"} num`}>
              %{formatNumber(Math.min(pct, 999), 0)}
            </span>
          </div>
          <div className="bar">
            <span
              style={{
                width: `${Math.max(2, Math.min(100, pct))}%`,
                background: done ? "var(--ok)" : "var(--accent)",
              }}
            />
          </div>
          <div className="kpi-sub">
            <span>
              Depo <b className="num">{formatNumber(wh, 0)} m</b>
            </span>
            <span>
              Hedef <b className="num">{formatNumber(target, 0)} m</b>
            </span>
          </div>
        </div>
      )}
    </>
  );
}

/** Termin geri-sayım çipi (v3 WorkOrderKpis ile aynı mantık). */
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

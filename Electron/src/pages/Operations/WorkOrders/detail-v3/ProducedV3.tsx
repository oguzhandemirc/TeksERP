import { formatNumber } from "@/lib/format";
import type { WorkOrder } from "../types";

/**
 * v3 üretilen nihai toplar — çıkan yoksa boş kutu (nerede işlendiği ipucuyla),
 * varsa özet (top·m + A1/Fire çipleri). Ayrıntılı liste ProducedRollsCard'dadır;
 * v3 detay sayfası özet+durum gösterir.
 */
export function ProducedV3({ wo, holdingText }: { wo: WorkOrder; holdingText?: string }) {
  const p = wo.producedRolls;
  if (!p || p.count === 0) {
    return (
      <div className="card">
        <div className="emptybox">
          <span className="ic">◪</span>
          Henüz depoya çıkan nihai top yok{holdingText ? ` — ${holdingText}` : ""}.
        </div>
      </div>
    );
  }
  return (
    <div className="card info">
      <div className="wc-sum">
        <span className="big num">
          {p.count} top · {formatNumber(p.totalMeters, 0)} m
        </span>
        {p.a1.count > 0 && <span className="chip dim num">A1: {p.a1.count}</span>}
        {p.fire.count > 0 && <span className="chip bad num">Fire: {p.fire.count}</span>}
      </div>
    </div>
  );
}

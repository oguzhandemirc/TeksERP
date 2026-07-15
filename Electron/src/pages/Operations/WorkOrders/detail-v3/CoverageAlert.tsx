import { useState } from "react";
import { Diamond, X } from "lucide-react";
import { formatNumber } from "@/lib/format";

/**
 * Koşullu kapsama-açığı uyarısı (v3): bağlı sipariş talebi bu iş emrine giren
 * ham metrajı aşıyorsa, "kalan için henüz üretim planlanmadı" der. Yalnız açık
 * varken görünür; kullanıcı gizleyebilir (oturum-içi).
 */
export function CoverageAlert({ requested, input }: { requested: number; input: number }) {
  const [hidden, setHidden] = useState(false);
  const gap = requested - input;
  if (hidden || gap < 1) return null;
  return (
    <div className="alert">
      <span className="ai">
        <Diamond className="h-4 w-4" fill="currentColor" />
      </span>
      <span className="at">
        <b>Kapsama açığı.</b> Bağlı siparişler {formatNumber(requested, 0)} m; bu iş emrine giren{" "}
        {formatNumber(input, 0)} m. Kalan <b>{formatNumber(gap, 0)} m</b> için henüz üretim planlanmadı.
      </span>
      <button className="ax" title="Gizle" aria-label="Uyarıyı gizle" onClick={() => setHidden(true)}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

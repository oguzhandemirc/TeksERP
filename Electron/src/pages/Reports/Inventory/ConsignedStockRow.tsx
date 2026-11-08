// Stok & Ölü Stok — EMANET satırı (genel fason P1). Yalnız emanet açıkken sunucu `summary.consigned` yollar; o zaman
// üstteki kutular BİZİM stoktur. Satır çıktı tablosuyla aynı üç kalemi aynı sırayla basar (`consignedRows`).
import { Handshake } from "lucide-react";
import { fmtInt, fmtNum } from "../_components/formatters";
import { consignedRows, type StockConsignedRow } from "./stockScorecard";

export function ConsignedStockRow({ consigned }: { consigned: StockConsignedRow }) {
  const rows = consignedRows(consigned);
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
      data-testid="stock-consigned-row"
    >
      <span className="flex items-center gap-1.5 font-semibold">
        <Handshake className="h-4 w-4 shrink-0" />
        Emanet (müşteri malı)
      </span>
      {rows.map((r) => (
        <span key={r.label} className="tabular-nums">
          {r.label}: <b>{fmtNum(r.qty)} m</b> ({fmtInt(r.count)} top)
        </span>
      ))}
      <span className="basis-full text-[11px] opacity-80">
        Yukarıdaki kutulara, yaş dağılımına ve ölü stoğa dahil değildir — müşterinin malı fabrikanın stoğu sayılmaz.
        Rafta fiziksel duran = bizim + emanet.
      </span>
    </div>
  );
}

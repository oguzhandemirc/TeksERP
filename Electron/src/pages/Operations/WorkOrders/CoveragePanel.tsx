import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, PackageCheck } from "lucide-react";
import { workOrderService, type CoverageLine } from "./service";

interface Props {
  lineIds: string[];
  excludeWorkOrderId?: string;
}

function fmt(n: number): string {
  return Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 1 });
}

/**
 * Üretim kapsama paneli — seçili sipariş kalemleri için "ne kadar üretmem lazım".
 * istenen − sevk − WO-rezerve − serbest depo − ham stok = net açık.
 * Serbest stok rezerve edilmez (anlık fotoğraf; planlamacı karar verir).
 */
export function CoveragePanel({ lineIds, excludeWorkOrderId }: Props) {
  const sortedKey = [...lineIds].sort();
  const q = useQuery({
    queryKey: ["wo-coverage", sortedKey, excludeWorkOrderId ?? null],
    queryFn: () => workOrderService.getCoverage(lineIds, excludeWorkOrderId),
    enabled: lineIds.length > 0,
    staleTime: 30_000,
  });
  const rows = q.data?.data ?? [];
  if (lineIds.length === 0) return null;

  return (
    <div className="rounded-md border bg-muted/10 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <PackageCheck className="h-3.5 w-3.5" /> Üretim Kapsama
      </div>
      {q.isLoading ? (
        <p className="text-xs text-muted-foreground">Hesaplanıyor…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Kapsama verisi yok.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <CoverageRow key={r.lineId} r={r} />
          ))}
          <p className="text-[10px] leading-tight text-muted-foreground">
            Serbest stok rezerve edilmez — anlık fotoğraf. Net açık eksi ise fazla
            var, üretim gerekmeyebilir.
          </p>
        </div>
      )}
    </div>
  );
}

function CoverageRow({ r }: { r: CoverageLine }) {
  const surplus = r.netGap <= 0;
  return (
    <div className="rounded border bg-background p-2 text-xs">
      <div className="mb-1 font-medium">
        {r.item.name}
        {r.color ? ` · ${r.color.name}` : ""}
        {r.width ? ` · ${fmt(r.width)}cm` : ""}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>İstenen</span>
        <span className="text-right tabular-nums text-foreground">{fmt(r.requested)}</span>
        <span>− Sevk edilen</span>
        <span className="text-right tabular-nums">{fmt(r.shipped)}</span>
        <span>− Üretimde (WO)</span>
        <span className="text-right tabular-nums">{fmt(r.reserved)}</span>
        <span>− Depoda hazır</span>
        <span className="text-right tabular-nums">{fmt(r.freeWarehouse)}</span>
        <span>− Ham stok</span>
        <span className="text-right tabular-nums">{fmt(r.freeStock)}</span>
      </div>
      <div
        className={
          "mt-1 flex items-center justify-between border-t pt-1 text-[11px] font-semibold " +
          (surplus
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-amber-600 dark:text-amber-400")
        }
      >
        <span className="flex items-center gap-1">
          {surplus ? (
            <PackageCheck className="h-3 w-3" />
          ) : (
            <AlertTriangle className="h-3 w-3" />
          )}
          {surplus ? "Net fazla (üretme)" : "Net üretim açığı"}
        </span>
        <span className="tabular-nums">
          {fmt(Math.abs(r.netGap))}
          {surplus ? " fazla" : ""}
        </span>
      </div>
    </div>
  );
}

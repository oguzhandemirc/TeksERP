import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, PackageCheck } from "lucide-react";
import { AnimatedNumber } from "@/components/motion";
import { cn } from "@/lib/utils";
import { orderQtyNumber } from "@/pages/Operations/Orders/order-cell-text";
import { workOrderService, type CoverageLine } from "./service";

interface Props {
  lineIds: string[];
  excludeWorkOrderId?: string;
}

function fmt(n: number): string {
  return Number(n).toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 0 });
}

interface SpecRow {
  key: string;
  label: string;
  count: number;
  requested: number;
  shipped: number;
  inProduction: number;
  freeWarehouse: number;
  freeStock: number;
  netGap: number;
}

/**
 * Aynı spec (kumaş+renk+en) kalemlerini tek satırda topla:
 * - istenen / sevk → TOPLANIR (kaleme özel muhasebe),
 * - üretimde / serbest depo / ham → PAYLAŞILAN havuz; aynı spec için her kalem
 *   aynı değeri döndürür, bir kez sayılır (Math.max ile çift sayım önlenir),
 * - net açık birleşik değerlerden yeniden hesaplanır.
 */
function aggregateBySpec(rows: CoverageLine[]): SpecRow[] {
  const map = new Map<string, SpecRow>();
  for (const r of rows) {
    const key = `${r.item.id}::${r.color?.id ?? ""}::${r.width ?? ""}`;
    const acc = map.get(key);
    if (!acc) {
      map.set(key, {
        key,
        label:
          r.item.name +
          (r.color ? ` · ${r.color.name}` : "") +
          (r.width ? ` · ${fmt(r.width)}cm` : ""),
        count: 1,
        requested: r.requested,
        shipped: r.shipped,
        inProduction: r.inProduction,
        freeWarehouse: r.freeWarehouse,
        freeStock: r.freeStock,
        netGap: 0,
      });
    } else {
      acc.count += 1;
      acc.requested += r.requested;
      acc.shipped += r.shipped;
      // Havuz paylaşılır: topla değil, bir kez al (aynı spec'te eşit olmalı).
      acc.inProduction = Math.max(acc.inProduction, r.inProduction);
      acc.freeWarehouse = Math.max(acc.freeWarehouse, r.freeWarehouse);
      acc.freeStock = Math.max(acc.freeStock, r.freeStock);
    }
  }
  for (const s of map.values()) {
    // Ham (freeStock) net açığa GİRMEZ — işlenmemiş girdi, mamul değil (yalnız bilgi).
    s.netGap = s.requested - s.shipped - s.freeWarehouse - s.inProduction;
  }
  return Array.from(map.values());
}

/**
 * Üretim kapsama paneli — seçili sipariş kalemleri için "ne kadar üretmem lazım".
 * istenen − sevk − WO-rezerve − serbest depo − ham stok = net açık.
 * Serbest stok rezerve edilmez (anlık fotoğraf; planlamacı karar verir).
 */
/** Kapsama metre defterinden — sipariş miktarıyla aynı biçim (yan panel başlığı 668,3 ise burada da). */
const qtyFmt = (v: number): string => orderQtyNumber(v, "MT");

function QtyCell({ value, tone }: { value: number; tone: string }) {
  return (
    <td className="text-right">
      <AnimatedNumber
        value={value}
        flash
        format={qtyFmt}
        className={cn("text-sm font-semibold", value > 0 ? tone : "text-muted-foreground")}
      />
    </td>
  );
}

function CoverageRow({ s }: { s: SpecRow }) {
  const surplus = s.netGap <= 0;
  return (
    <tr className="border-t [&>td]:px-1.5 [&>td]:py-1">
      <td className="text-left">
        <span className="text-sm font-bold text-foreground">{s.label}</span>
        {s.count > 1 && <span className="text-muted-foreground"> · {s.count} kalem</span>}
      </td>
      <td className="text-right">
        <AnimatedNumber
          value={s.requested}
          flash
          format={qtyFmt}
          className="text-sm font-bold text-foreground"
        />
      </td>
      <QtyCell value={s.shipped} tone="text-info" />
      <QtyCell value={s.inProduction} tone="text-station-process" />
      <QtyCell value={s.freeWarehouse} tone="text-success" />
      <QtyCell value={s.freeStock} tone="text-station-depo" />
      <td className="text-right">
        <span
          className={cn(
            "inline-flex items-center justify-end gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-sm font-bold",
            surplus ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
          )}
        >
          {surplus ? (
            <PackageCheck className="h-3.5 w-3.5" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" />
          )}
          <AnimatedNumber value={Math.abs(s.netGap)} flash format={qtyFmt} />
          {surplus ? " fazla" : ""}
        </span>
      </td>
    </tr>
  );
}

export function CoveragePanel({ lineIds, excludeWorkOrderId }: Props) {
  const sortedKey = [...lineIds].sort();
  const q = useQuery({
    queryKey: ["wo-coverage", sortedKey, excludeWorkOrderId ?? null],
    queryFn: () => workOrderService.getCoverage(lineIds, excludeWorkOrderId),
    enabled: lineIds.length > 0,
    staleTime: 30_000,
  });
  if (lineIds.length === 0) return null;
  const specs = aggregateBySpec(q.data?.data ?? []);

  return (
    <div className="rounded-lg border border-info/30 bg-info/5 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-info">
        <PackageCheck className="h-3.5 w-3.5" /> Üretim Kapsama
      </div>
      {q.isLoading ? (
        <p className="text-xs text-muted-foreground">Hesaplanıyor…</p>
      ) : specs.length === 0 ? (
        <p className="text-xs text-muted-foreground">Kapsama verisi yok.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] tabular-nums">
              <thead>
                <tr className="text-muted-foreground [&>th]:px-1.5 [&>th]:py-1 [&>th]:font-medium">
                  <th className="text-left">Kumaş</th>
                  <th className="text-right">İstenen</th>
                  <th className="text-right" title="Sevk edilen">Sevk</th>
                  <th className="text-right" title="Üretimde — canlı iş emirleri">Üretim</th>
                  <th className="text-right" title="Depoda hazır — eşleşen serbest stok">Depo</th>
                  <th className="text-right" title="Ham stok — işlenmemiş kumaş (bilgi; net açığa girmez)">Ham</th>
                  <th className="text-right">Net açık</th>
                </tr>
              </thead>
              <tbody>
                {specs.map((s) => (
                  <CoverageRow key={s.key} s={s} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

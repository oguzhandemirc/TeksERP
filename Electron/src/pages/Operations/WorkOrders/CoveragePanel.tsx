import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, PackageCheck } from "lucide-react";
import { AnimatedNumber } from "@/components/motion";
import { cn } from "@/lib/utils";
import { workOrderService, type CoverageLine } from "./service";

interface Props {
  lineIds: string[];
  excludeWorkOrderId?: string;
}

function fmt(n: number): string {
  return Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 0 });
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
 * Aynı spec (ürün+renk+en) kalemlerini tek satırda topla:
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
                  <th className="text-left">Ürün</th>
                  <th className="text-right">İstenen</th>
                  <th className="text-right" title="Sevk edilen">Sevk</th>
                  <th className="text-right" title="Üretimde — canlı iş emirleri">WO</th>
                  <th className="text-right" title="Depoda hazır — eşleşen serbest stok">Depo</th>
                  <th className="text-right" title="Ham stok — işlenmemiş kumaş (bilgi; net açığa girmez)">Ham</th>
                  <th className="text-right">Net açık</th>
                </tr>
              </thead>
              <tbody>
                {specs.map((s) => {
                  const surplus = s.netGap <= 0;
                  return (
                    <tr key={s.key} className="border-t [&>td]:px-1.5 [&>td]:py-1">
                      <td className="text-left">
                        <span className="text-sm font-bold text-foreground">{s.label}</span>
                        {s.count > 1 && (
                          <span className="text-muted-foreground"> · {s.count} kalem</span>
                        )}
                      </td>
                      <td className="text-right">
                        <AnimatedNumber
                          value={s.requested}
                          flash
                          className="text-sm font-bold text-foreground"
                        />
                      </td>
                      <td className="text-right">
                        <AnimatedNumber
                          value={s.shipped}
                          flash
                          className={cn(
                            "text-sm font-semibold",
                            s.shipped > 0 ? "text-info" : "text-muted-foreground",
                          )}
                        />
                      </td>
                      <td className="text-right">
                        <AnimatedNumber
                          value={s.inProduction}
                          flash
                          className={cn(
                            "text-sm font-semibold",
                            s.inProduction > 0
                              ? "text-station-process"
                              : "text-muted-foreground",
                          )}
                        />
                      </td>
                      <td className="text-right">
                        <AnimatedNumber
                          value={s.freeWarehouse}
                          flash
                          className={cn(
                            "text-sm font-semibold",
                            s.freeWarehouse > 0 ? "text-success" : "text-muted-foreground",
                          )}
                        />
                      </td>
                      <td className="text-right">
                        <AnimatedNumber
                          value={s.freeStock}
                          flash
                          className={cn(
                            "text-sm font-semibold",
                            s.freeStock > 0 ? "text-station-depo" : "text-muted-foreground",
                          )}
                        />
                      </td>
                      <td className="text-right">
                        <span
                          className={cn(
                            "inline-flex items-center justify-end gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-sm font-bold",
                            surplus
                              ? "bg-success/15 text-success"
                              : "bg-warning/15 text-warning",
                          )}
                        >
                          {surplus ? (
                            <PackageCheck className="h-3.5 w-3.5" />
                          ) : (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          )}
                          <AnimatedNumber value={Math.abs(s.netGap)} flash />
                          {surplus ? " fazla" : ""}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] leading-tight text-muted-foreground">
            Net açık = istenen − sevk − depo − üretimde. Ham (işlenmemiş kumaş)
            buna girmez — yalnız bilgi; üretmen gerekirse kumaş tedariki gerekip
            gerekmediğini gösterir. Net açık eksi ise fazla var, üretim gerekmeyebilir.
          </p>
        </>
      )}
    </div>
  );
}

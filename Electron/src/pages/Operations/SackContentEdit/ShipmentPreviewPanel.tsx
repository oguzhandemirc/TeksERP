import { PackageCheck } from "lucide-react";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { CreateShipmentPreview } from "./types";
import { lowerTr } from "../../../lib/tr-case";

const fmtM = (n: number) => `${n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 })} m`;

/** Uyarı tonu — mükerrer sevk kırmızı (danger), diğerleri amber (warning). */
function warnTone(text: string): "danger" | "warning" {
  return lowerTr(text).includes("mükerrer") ? "danger" : "warning";
}

interface Props {
  preview: CreateShipmentPreview | undefined;
  isLoading: boolean;
}

/**
 * Sevkiyat önizlemesi — DİKKAT noktası. Fazla mal / mükerrer / siparişsiz uyarıları
 * belirgin renkli kutularda; sipariş satırı bazında ihtiyaç vs tahsis tablosu.
 */
export function ShipmentPreviewPanel({ preview, isLoading }: Props) {
  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (!preview) return <p className="py-4 text-center text-sm text-muted-foreground">Önizleme alınamadı.</p>;

  const { totals, warnings, lines } = preview;

  return (
    <div className="space-y-3">
      {/* Özet + fazla mal vurgusu */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <span>
          <span className="font-semibold tabular-nums">{totals.sackCount}</span> çuval
        </span>
        <span>
          <span className="font-semibold tabular-nums">{fmtM(totals.totalMeters)}</span> toplam
        </span>
        {totals.surplusMeters > 0.5 && (
          <span className="ml-auto rounded bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-400">
            Siparişe yazılmayan: {fmtM(totals.surplusMeters)}
          </span>
        )}
      </div>

      {/* Uyarılar — BÜYÜK, renkli, ikonlu (kaçırılamaz) */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <Callout key={i} tone={warnTone(w)}>
              {w}
            </Callout>
          ))}
        </div>
      )}

      {/* Sipariş satır bazında ihtiyaç vs tahsis */}
      {lines.length > 0 ? (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-1.5 font-medium">Sipariş · Kumaş</th>
                <th className="px-3 py-1.5 text-right font-medium">İhtiyaç</th>
                <th className="px-3 py-1.5 text-right font-medium">Bu sevk</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const full = l.allocated + 0.5 >= l.need;
                return (
                  <tr key={l.lineId} className="border-b last:border-0">
                    <td className="px-3 py-1.5">
                      <span className="font-mono font-medium">{l.orderNumber}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {l.item}
                        {l.color ? ` · ${l.color}` : ""}
                        {l.width != null ? ` · ${l.width}cm` : ""}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtM(l.need)}</td>
                    <td className={cn("px-3 py-1.5 text-right font-semibold tabular-nums", full ? "text-emerald-600" : "text-amber-600")}>
                      {fmtM(l.allocated)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <PackageCheck className="h-4 w-4" /> Sipariş satırı tahsisi yok — mal siparişe sayılmadan çıkacak.
        </div>
      )}
    </div>
  );
}

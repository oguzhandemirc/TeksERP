import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { RetargetPreview } from "./service";

interface Props {
  preview: RetargetPreview | undefined;
  isFetching: boolean;
  /** Hiç sipariş seçili değilse projeksiyon istenmez — bilgi metni göster. */
  hasSelection: boolean;
}

const fmtMeters = (n: number) =>
  `${n.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} m`;

/** Kapsama yüzdesine göre renk: tam=yeşil, kısmi=amber, 0=kırmızı. */
function coverageTone(pct: number): string {
  if (pct >= 100) return "text-emerald-600 dark:text-emerald-400";
  if (pct <= 0) return "text-red-600 dark:text-red-400";
  return "text-amber-600 dark:text-amber-400";
}

/**
 * Saha #7 (artımlı): seçili sipariş kümesi için SALT-OKUNUR karşılanma projeksiyonu.
 * Operatör commit'ten ÖNCE her siparişin planlanan/projeksiyon/kapsama%'sini ve
 * toplam mal/tahsis/artan'ı görür. Artan (leftover) > 0 → "fazla mal" uyarısı.
 */
export function RetargetProjection({ preview, isFetching, hasSelection }: Props) {
  if (!hasSelection) {
    return (
      <p className="px-1 py-2 text-center text-xs text-muted-foreground">
        Projeksiyon için en az bir sipariş seç.
      </p>
    );
  }
  if (!preview) {
    return <Skeleton className="h-24 w-full" />;
  }

  const { orders, totals, ignored } = preview;
  const hasLeftover = totals.leftover > 0;

  return (
    <div className="space-y-2 text-sm" data-testid="retarget-projection">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-muted-foreground">
          Karşılanma projeksiyonu (önizleme — kaydedilmedi)
        </span>
        {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <div className="overflow-hidden rounded-md border">
        <table className="w-full">
          <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-left font-medium">Sipariş</th>
              <th className="px-2 py-1 text-right font-medium">Planlanan</th>
              <th className="px-2 py-1 text-right font-medium">Projeksiyon</th>
              <th className="px-2 py-1 text-right font-medium">Kapsama</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-3 text-center text-xs text-muted-foreground">
                  Geçerli sipariş yok.
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr key={o.orderId} className="border-t">
                  <td className="px-2 py-1.5 font-mono text-xs">{o.orderNumber}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtMeters(o.planned)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtMeters(o.projected)}</td>
                  <td
                    className={cn(
                      "px-2 py-1.5 text-right font-semibold tabular-nums",
                      coverageTone(o.coveragePct),
                    )}
                  >
                    %{o.coveragePct}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Özet bar: toplam mal / tahsis / artan */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border px-3 py-2 text-xs",
          hasLeftover && "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40",
        )}
      >
        <span>
          Toplam mal: <span className="font-semibold tabular-nums">{fmtMeters(totals.goods)}</span>
        </span>
        <span>
          Tahsis edilen:{" "}
          <span className="font-semibold tabular-nums">{fmtMeters(totals.projectedTotal)}</span>
        </span>
        <span className={cn(hasLeftover && "font-semibold text-amber-700 dark:text-amber-400")}>
          Artan: <span className="tabular-nums">{fmtMeters(totals.leftover)}</span>
        </span>
      </div>

      {hasLeftover && (
        <p className="flex items-center gap-1.5 px-1 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Fazla mal: seçili siparişlerin ihtiyacından {fmtMeters(totals.leftover)} fazla yüklü —
          başka sipariş ekleyin veya malı azaltın.
        </p>
      )}

      {ignored.length > 0 && (
        <div className="px-1 text-xs text-muted-foreground">
          <span className="font-medium">Atlanan:</span>{" "}
          {ignored.map((i) => `${i.orderNumber} (${i.reason})`).join(", ")}
        </div>
      )}
    </div>
  );
}

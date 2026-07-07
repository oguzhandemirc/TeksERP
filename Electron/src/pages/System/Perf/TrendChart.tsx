import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SimpleLineChart } from "@/pages/Reports/_components/SimpleLineChart";
import { usePerfHistory } from "./perfService";

const ALL = "__all__"; // Select boş string value kabul etmez — sentinel

/** Günlük p50/p95 trendi — kalıcı özetlerden (restart'lar veri kaybettirmez).
 *  Route seçilmezse tüm uçların birleşik toplamı çizilir. */
export function TrendChart({
  days,
  route,
  onRouteChange,
}: {
  days: number;
  route: string | null;
  onRouteChange: (route: string | null) => void;
}) {
  const historyQ = usePerfHistory(days, route);
  const series = historyQ.data?.series ?? [];
  const routes = historyQ.data?.routes ?? [];

  return (
    <div className="space-y-3">
      <Select
        value={route ?? ALL}
        onValueChange={(v) => onRouteChange(v === ALL ? null : v)}
      >
        <SelectTrigger className="w-full max-w-md font-mono text-xs">
          <SelectValue placeholder="Endpoint seç" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>(tüm endpoint'ler — birleşik)</SelectItem>
          {routes.map((r) => (
            <SelectItem key={r} value={r} className="font-mono text-xs">
              {r}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {series.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {historyQ.isPending
            ? "Yükleniyor…"
            : historyQ.isError
              ? "Geçmiş alınamadı — sunucuya ulaşılamıyor veya yetki yok."
              : "Bu aralıkta kalıcı özet yok — özetler ~5 dk'da bir yazılır."}
        </p>
      ) : (
        <div className="h-64">
          <SimpleLineChart
            data={series}
            xKey="day"
            lines={[
              { key: "p95Ms", label: "p95 (ms)" },
              { key: "p50Ms", label: "p50 (ms)" },
            ]}
            formatValue={(v) => `${v} ms`}
            formatCategory={(d) => d.slice(5)} // "MM-DD"
          />
        </div>
      )}
    </div>
  );
}

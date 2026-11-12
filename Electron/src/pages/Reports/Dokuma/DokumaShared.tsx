// =============================================================================
// DOKUMA RAPORLARI — ortak parçalar: uyarılar · tarih aralığı → fabrika günü ·
// süre biçimi · mühür rozeti · sayfa yükleme
// =============================================================================
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReportKey } from "@/lib/report-catalog";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { rangeDayParams } from "../_lib/report-date";

export function WarningsBlock({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
      {warnings.map((w, i) => (
        <li key={i}>⚠️ {w}</li>
      ))}
    </ul>
  );
}

/** URL'deki tarih aralığını FABRİKA GÜNÜ `YYYY-MM-DD` çiftine çevirir (`aralik-gun` sözleşmesi; varsayılan gün katalogdan). */
export function useFactoryRange(reportKey: ReportKey): { from: string; to: string; ready: boolean } {
  const { params } = useReportDateRange(reportKey);
  return useMemo(
    () => ({ ...rangeDayParams(params.dateFrom, params.dateTo), ready: Boolean(params.dateFrom && params.dateTo) }),
    [params.dateFrom, params.dateTo],
  );
}

/** Saniye → "1 sa 05 dk" (0 → "0 dk"). Sayı uydurulmaz: yalnız biçim. */
export function fmtSec(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h} sa ${String(m).padStart(2, "0")} dk` : `${m} dk`;
}

export function SealBadge({ sealState, live }: { sealState: "OPEN" | "SEALED"; live: boolean }) {
  return sealState === "SEALED" ? (
    <Badge variant="secondary">Mühürlü</Badge>
  ) : (
    <Badge variant="outline">{live ? "Anlık" : "Açık"}</Badge>
  );
}

/** Sayfalı liste: toplamlar tam kümeden gelir, satırlar sayfa sayfa yüklenir. */
export function LoadMoreRows({ loaded, total, hasMore, loading, onMore }: { loaded: number; total: number | undefined; hasMore: boolean; loading: boolean; onMore: () => void }) {
  if (!hasMore) return null;
  return (
    <div className="flex items-center justify-center gap-3 py-2 text-xs text-muted-foreground">
      <span>{loaded} / {total ?? "?"} satır yüklendi</span>
      <Button size="sm" variant="outline" disabled={loading} onClick={onMore}>{loading ? "Yükleniyor…" : "Daha fazla yükle"}</Button>
    </div>
  );
}

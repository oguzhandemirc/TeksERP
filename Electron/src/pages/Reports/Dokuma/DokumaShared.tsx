// =============================================================================
// DOKUMA RAPORLARI — ortak parçalar: kaynak kırılımı şeridi · ufuk notu · uyarılar ·
// tarih aralığı → fabrika günü · süre biçimi
// =============================================================================
// Rapor değişmezi ①: her toplam satırı KAYNAK KIRILIMINI taşır, tek yüzdeye
// çökertilmez — şerit bu yüzden her sayfada aynı bileşendir. Değişmez ②: ufuk
// yazılır — "şu günden sonrası ölçülü", ufuk öncesi satır sayısıyla.
// =============================================================================
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import type { ReportKey } from "@/lib/report-catalog";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { rangeDayParams } from "../_lib/report-date";
import { SOURCE_LABELS, type DataSource } from "./dokuma-regime";
import type { LoomReportMeta, SourceBreakdownTable } from "./service";

const SOURCE_ORDER: DataSource[] = ["MACHINE", "OPERATOR", "SUPERVISOR", "SIMULATED", "INFERRED"];

export function SourceBreakdownStrip({ kirilim, unit = "satır" }: { kirilim: SourceBreakdownTable | undefined; unit?: string }) {
  if (!kirilim) return null;
  const total = SOURCE_ORDER.reduce((a, k) => a + (kirilim[k]?.satir ?? 0), 0);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
      <span className="font-semibold text-muted-foreground">Kaynak kırılımı ({total} {unit}):</span>
      {SOURCE_ORDER.map((k) => {
        const n = kirilim[k]?.satir ?? 0;
        if (n === 0) return null;
        return (
          <Badge key={k} variant={k === "SIMULATED" ? "destructive" : k === "INFERRED" ? "outline" : "secondary"}>
            {SOURCE_LABELS[k]}: {n}
          </Badge>
        );
      })}
      <span className="text-muted-foreground">— tek yüzdeye çökertilmez; simüle değer elle girişten ayrı sayılır.</span>
    </div>
  );
}

export function HorizonNote({ meta }: { meta: LoomReportMeta | undefined }) {
  if (!meta) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Ölçüm ufku: <span className="font-mono">{meta.ufuk}</span> sonrası ölçülüdür
      {meta.ufukOncesiSatir > 0 ? ` · ufuk öncesi ${meta.ufukOncesiSatir} satır (eksik olabilir)` : ""}
      {meta.truncated ? ` · liste ${meta.total} satırdan kırpıldı — aralığı daraltın` : ""}
      {` · anlık ${meta.live} · mühürlü ${meta.sealed}`}
    </p>
  );
}

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

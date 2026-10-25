// Zil + kırmızı şerit + ses/bildirim AYNI yoklamayı paylaşır (tek istek, tek önbellek anahtarı).
// Liste geniş çekilir (zil ilk 8'i çizer): eski bir alarmın kademe atlaması da görülsün.
// Bildirim zili akışı (SSE) sağlıklıyken alarm `zil {k:'alarm'}` ile ANINDA tazelenir, yoklama 60 sn
// yedektir; akış yoksa (bayrak kapalı, eski backend, yoklamaya düşüş) bugünkü 15 sn sürer.
import { useEffect, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { bellClient } from "@/lib/bildirim/hooks";
import { bellStreamHealthy } from "@/lib/bildirim/zil-istemcisi";
import { loomAlarmService } from "./service";

export const LOOM_ALARM_BELL_QUERY_KEY = ["loom-alarms", "bell"] as const;
export const LOOM_ALARM_BELL_POLL_MS = 15_000;
export const LOOM_ALARM_BELL_POLL_HEALTHY_MS = 60_000;
export const LOOM_ALARM_WATCH_LIMIT = 50;

const healthySnapshot = () => bellStreamHealthy(bellClient.durum());

/** Yoklama aralığı zil akışının sağlığına bağlı: sağlıklı → 60 sn, değil → 15 sn. */
export function loomAlarmPollMs(healthy: boolean): number {
  return healthy ? LOOM_ALARM_BELL_POLL_HEALTHY_MS : LOOM_ALARM_BELL_POLL_MS;
}

export function useLoomAlarmBellQuery(enabled: boolean) {
  const qc = useQueryClient();
  const healthy = useSyncExternalStore(bellClient.dinle, healthySnapshot, healthySnapshot);
  useEffect(() => {
    if (!enabled) return;
    return bellClient.olayDinle((o) => {
      if (o === "alarm" || o === "tam") void qc.invalidateQueries({ queryKey: LOOM_ALARM_BELL_QUERY_KEY });
    });
  }, [enabled, qc]);
  return useQuery({
    queryKey: LOOM_ALARM_BELL_QUERY_KEY,
    queryFn: () => loomAlarmService.list({ scope: "active", limit: LOOM_ALARM_WATCH_LIMIT }, true),
    enabled,
    // tab-aktif-muaf: kabuk yoklayıcısı — sekmeden bağımsız, panel başına tek örnek.
    refetchInterval: loomAlarmPollMs(healthy),
    staleTime: 5_000,
    retry: false,
  });
}

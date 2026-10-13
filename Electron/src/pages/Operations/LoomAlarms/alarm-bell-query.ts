// Zil + kırmızı şerit + ses/bildirim AYNI yoklamayı paylaşır (tek istek, tek önbellek anahtarı).
// Liste geniş çekilir (zil ilk 8'i çizer): eski bir alarmın kademe atlaması da görülsün.
import { useQuery } from "@tanstack/react-query";
import { loomAlarmService } from "./service";

export const LOOM_ALARM_BELL_QUERY_KEY = ["loom-alarms", "bell"] as const;
export const LOOM_ALARM_BELL_POLL_MS = 15_000;
export const LOOM_ALARM_WATCH_LIMIT = 50;

export function useLoomAlarmBellQuery(enabled: boolean) {
  return useQuery({
    queryKey: LOOM_ALARM_BELL_QUERY_KEY,
    queryFn: () => loomAlarmService.list({ scope: "active", limit: LOOM_ALARM_WATCH_LIMIT }, true),
    enabled,
    // tab-aktif-muaf: kabuk yoklayıcısı — sekmeden bağımsız, panel başına tek örnek.
    refetchInterval: LOOM_ALARM_BELL_POLL_MS,
    staleTime: 5_000,
    retry: false,
  });
}

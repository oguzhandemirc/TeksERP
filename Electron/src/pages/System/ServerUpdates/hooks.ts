import { useQuery } from "@tanstack/react-query";
import { serverUpdateService } from "@/services/serverUpdateService";
import type { UpdateSummary } from "@/types/server-update";

export const SERVER_UPDATE_KEY = ["server-update"] as const;
export const SERVER_UPDATE_SUMMARY_KEY = ["server-update-summary"] as const;

/** İş sürerken (indirme · uygulama) ilerleme sık tazelenir; boşta güncelleyici dakikada bir yazar. */
export function refetchIntervalFor(s: UpdateSummary | undefined): number {
  return s?.yerel && (s.yerel.durum === "INDIRILIYOR" || s.yerel.durum === "UYGULANIYOR") ? 5_000 : 30_000;
}

/** `enabled=false`: izinsiz kullanıcı ya da eski backend için istek atılmaz (kabuk bileşenleri izne göre açar). */
export function useServerUpdateStatus(enabled = true) {
  return useQuery({
    queryKey: SERVER_UPDATE_KEY,
    queryFn: serverUpdateService.status,
    enabled,
    refetchInterval: (q) => refetchIntervalFor(q.state.data),
    retry: false,
  });
}

/** Lisans izni olmayan kullanıcının "Sunucu" satırı — yalnız özet (`/ozet`); izinli kullanıcı tam durumu okur. */
export function useServerUpdateSummary(enabled = true) {
  return useQuery({
    queryKey: SERVER_UPDATE_SUMMARY_KEY,
    queryFn: serverUpdateService.summary,
    enabled,
    refetchInterval: (q) => refetchIntervalFor(q.state.data),
    retry: false,
  });
}

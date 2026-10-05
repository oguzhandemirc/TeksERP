import { useQuery } from "@tanstack/react-query";
import { serverUpdateService } from "@/services/serverUpdateService";
import type { UpdateStatus } from "@/types/server-update";

export const SERVER_UPDATE_KEY = ["server-update"] as const;

/** İş sürerken (indirme · uygulama) ilerleme sık tazelenir; boşta güncelleyici dakikada bir yazar. */
export function refetchIntervalFor(s: UpdateStatus | undefined): number {
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

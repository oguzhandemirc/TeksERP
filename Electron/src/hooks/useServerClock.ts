import { useEffect, useState } from "react";
import apiClient from "@/services/apiClient";
import { useServerStatusStore } from "@/store/serverStatus";

/** Son ulaşılabilir yanıt bundan eskiyse client idle sayılır → heartbeat at. */
const IDLE_THRESHOLD_MS = 25_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Backend durumunu güncel tutan hafif heartbeat. Aktif kullanıcının zaten attığı
 * istekler durumu tazeler (interceptor) → bu hook YALNIZ client idle kaldığında
 * (son ulaşılabilirlik > 25sn) ya da offline'ken /health'e tek GET atar. /health
 * public + tek in-memory round-trip (tablo taraması yok, poll'e güvenli). Heartbeat
 * hatası toast'lanmaz. AppShell'de bir kez mount edilir (sidebar daralsa da sürer).
 */
export function useServerHeartbeat(): void {
  useEffect(() => {
    const timer = setInterval(() => {
      const { status, lastReachableAt } = useServerStatusStore.getState();
      const idle = !lastReachableAt || Date.now() - lastReachableAt > IDLE_THRESHOLD_MS;
      if (status === "offline" || idle) {
        // Sonuç interceptor'da markReachable/markUnreachable'a düşer.
        void apiClient.get("/health", { suppressErrorToast: true }).catch(() => {});
      }
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
}

/**
 * Sunucu saatini (offset + yerel tik) ve bağlantı durumunu döndürür. Tik DAKİKA
 * sınırına hizalı (dakikada bir uyanır, saniyede değil → ucuz); offset değişince
 * (yeniden senkron) anında yeniden hesaplanır. Yalnız gösterimde, küçük bir yaprak
 * bileşende çağrılmalı — her tik tüm app'i render etmesin.
 */
export function useServerClock(): {
  status: "connecting" | "online" | "offline";
  serverDate: Date;
} {
  const status = useServerStatusStore((s) => s.status);
  const offsetMs = useServerStatusStore((s) => s.offsetMs);
  const [, setTick] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const serverNow = Date.now() + offsetMs;
      const msToNextMinute = 60_000 - (serverNow % 60_000);
      timer = setTimeout(() => {
        setTick((t) => t + 1);
        schedule();
      }, msToNextMinute + 50);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [offsetMs]);

  return { status, serverDate: new Date(Date.now() + offsetMs) };
}

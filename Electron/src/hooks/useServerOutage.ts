import { useEffect, useState, useSyncExternalStore } from "react";
import { useServerUpdateSummary } from "@/pages/System/ServerUpdates/hooks";
import { getOutageTarget, outageTarget, setOutageTarget, subscribeOutage, type OutageTarget } from "@/lib/sunucu-kesintisi";

/**
 * Oturumdaki her ekranda sunucunun planlı kesintisini `/ozet`ten yoklar (izinsiz uç; 30 sn) ve ortak hedefe yazar.
 * Yoklama düşerse (sunucu kapalı) son hedef korunur — kesinti şeridi ve istek bekletme onu okur.
 */
export function useOutagePolling(enabled: boolean): void {
  const { data, dataUpdatedAt } = useServerUpdateSummary(enabled);
  useEffect(() => {
    if (!enabled) setOutageTarget(null);
    else if (data) setOutageTarget(outageTarget(data.kesinti, dataUpdatedAt));
  }, [enabled, data, dataUpdatedAt]);
}

export function useOutageTarget(): OutageTarget | null {
  return useSyncExternalStore(subscribeOutage, getOutageTarget);
}

/** Hedef varken saati tikletir (kalan dakika metni ve duyuru eşiği kendiliğinden ilerlesin). */
export function useOutageClock(target: OutageTarget | null, tickMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!target) return;
    const t = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(t);
  }, [target, tickMs]);
  return now;
}

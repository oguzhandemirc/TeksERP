import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/api';
import { useAuthStore } from '../store/authStore';
import type { ApiResponse } from '../types/api';
import {
  OUTAGE_POLL_MS,
  getOutageTarget,
  outageTarget,
  setOutageTarget,
  subscribeOutage,
  type OutageNotice,
  type OutageTarget,
} from '../lib/sunucu-kesintisi';

// Sunucunun planlı güncelleme kesintisi — `/guncelleme/ozet` (oturumlu herkes; kalıcı önbelleğe GİRMEZ).
// Eski backend `kesinti` göndermez → hedef yok. Yoklama düşerse (sunucu kapalı) son hedef korunur.
export const SERVER_OUTAGE_KEY = ['guncelleme', 'ozet'] as const;

interface SummaryOutage {
  kesinti?: OutageNotice | null;
}

export function useOutagePolling(): void {
  const hasToken = useAuthStore((s) => !!s.token);
  const { data, dataUpdatedAt } = useQuery({
    queryKey: SERVER_OUTAGE_KEY,
    queryFn: () => apiClient.get<ApiResponse<SummaryOutage>>('/guncelleme/ozet').then((r) => r.data.data),
    enabled: hasToken,
    refetchInterval: OUTAGE_POLL_MS,
    retry: false,
  });
  useEffect(() => {
    if (!hasToken) setOutageTarget(null);
    else if (data) setOutageTarget(outageTarget(data.kesinti, dataUpdatedAt));
  }, [hasToken, data, dataUpdatedAt]);
}

export function useOutageTarget(): OutageTarget | null {
  return useSyncExternalStore(subscribeOutage, getOutageTarget);
}

/** Hedef varken saati tikletir (kalan dakika ve duyuru eşiği kendiliğinden ilerlesin). */
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

// =============================================================================
// TEZGAH ALARMI — erişim, akış (15 sn yoklama) ve alarm sayfası verisi
// =============================================================================
// Yoklama yalnız uygulama ÖN PLANDAYKEN koşar (Android arka planda JS'i durdurur; ölçüm
// `services/alarmNotify.ts` başlığında). Erişim/bayrak kapalıyken istek hiç atılmaz.
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePermissions } from './usePermission';
import { useFeatureFlags } from './useFeatureFlags';
import { loomAlarmAccessOf, type LoomAlarmAccessFull } from '../lib/loomAlarm/access';
import { loomAlarmKeys } from '../lib/loomAlarm/keys';
import { loomAlarmService } from '../services/loomAlarm.service';

export const ALARM_POLL_MS = 15_000;

export function useLoomAlarmAccess(): LoomAlarmAccessFull {
  const { has } = usePermissions();
  const flags = useFeatureFlags().data;
  return useMemo(() => loomAlarmAccessOf(has, flags), [has, flags]);
}

/** Aktif alarmlar. `mine`: sunucu sorumlu süzgecini tanıyorsa yalnız bana bildirilenler. */
export function useLoomAlarmFeed(p: { enabled: boolean; mine: boolean; machineId?: string }) {
  return useQuery({
    queryKey: loomAlarmKeys.feed(p),
    queryFn: () => loomAlarmService.list({ scope: 'active', mine: p.mine, machineId: p.machineId, limit: 100 }),
    enabled: p.enabled,
    refetchInterval: ALARM_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

export function useLoomAlarmDetail(alarmId: string, enabled: boolean) {
  return useQuery({
    queryKey: loomAlarmKeys.detail(alarmId),
    queryFn: () => loomAlarmService.detail(alarmId),
    enabled,
    refetchInterval: ALARM_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/** Canlı sayaç için saat tıkı (yalnız ekran açıkken; arka planda JS zaten durur). */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

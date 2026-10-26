// Zil durumu + AppState köprüsü. Bayrak kapalı/eski backend → istemci hiç kurulmaz (zil, şerit, akış yok;
// alarm 15 sn aynen). Zil olayları gelen kutusu sorgularını, "alarm" olayı tezgah alarmı sorgusunu tazeler.
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useFeatureFlags } from './useFeatureFlags';
import { resolveNotificationInboxEnabled } from '../services/featureFlag.service';
import { bellClient } from '../services/bildirim/bellSingleton';
import { bellHealthy, type BellState } from '../services/bildirim/bellClient';
import { loomAlarmKeys } from '../lib/loomAlarm/keys';
import { INBOX_KEY } from '../services/bildirim/keys';

export { INBOX_KEY };

const OFF_STATE: BellState = {
  ready: false, supported: false, enabled: false, unread: 0, openAlarms: 0, epoch: null, rev: 0, alarmRev: 0, mode: 'off', connected: false,
};

let mounts = 0;
let appStateSub: { remove(): void } | null = null;

/** Referans sayımlı: ilk bağlanan AppState'i dinler, son ayrılan bağlantıyı kapatır. */
function attach(): () => void {
  mounts++;
  if (mounts === 1) {
    const c = bellClient();
    // Açılışta durum 'unknown' olabilir: arka planda olduğu KESİN değilse ön plan say.
    void c.setActive(AppState.currentState !== 'background');
    appStateSub = AppState.addEventListener('change', (st) => void c.setActive(st === 'active'));
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mounts--;
    if (mounts > 0) return;
    appStateSub?.remove();
    appStateSub = null;
    void bellClient().setActive(false);
  };
}

export function useNotificationInboxEnabled(): boolean {
  return resolveNotificationInboxEnabled(useFeatureFlags().data);
}

export function useNotificationBell(): BellState {
  const enabled = useNotificationInboxEnabled();
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const detach = attach();
    const off = bellClient().onEvent((e) => {
      if (e === 'alarm') void qc.invalidateQueries({ queryKey: loomAlarmKeys.all });
      else void qc.invalidateQueries({ queryKey: INBOX_KEY });
    });
    return () => {
      off();
      detach();
    };
  }, [enabled, qc]);
  const st = useSyncExternalStore(bellClient().subscribe, bellClient().state);
  return enabled ? st : OFF_STATE;
}

/** Alarm yoklaması için: zil sağlıklı mı (bayrak kapalıyken hep false → 15 sn aynen). */
export function useBellHealthy(): boolean {
  const enabled = useNotificationInboxEnabled();
  const st = useSyncExternalStore(bellClient().subscribe, bellClient().state);
  return enabled && bellHealthy(st);
}

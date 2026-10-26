// Bildirim tercihi yazımı — çevrimdışı kuyruk (react-query paused mutation, App.tsx persist).
// PUT tam gövdedir: kuyrukta aynı kişinin YALNIZ son taslağı kalır (eskisi düşer, iki kez yazılmaz).
// Operatör değişirse eski kişinin taslağı yeni kişinin token'ıyla YAZILMAZ (sessizce düşer).
import { queryClient } from './queryClient';
import { stationRetry, stationRetryDelay } from './mutations';
import { useAuthStore } from '../store/authStore';
import { bildirimApi } from '../services/bildirim/bildirimApi';
import type { PreferenceItem } from '../services/bildirim/types';

export const NOTIFICATION_PREF_SAVE = ['bildirim', 'tercih-kaydet'] as const;
export const NOTIFICATION_PREFS_KEY = ['bildirim', 'tercihler'] as const;

// clientToken YOK: tam gövdeli PUT idempotenttir (aynı gövdenin tekrarı aynı sonucu verir) ve kayıt yaratmaz;
// tekilleştirme kuyrukta kişi başına son taslakla yapılır.
export interface PreferenceSaveVars {
  userId: string;
  tercihler: PreferenceItem[];
}

export function registerNotificationMutationDefaults(): void {
  queryClient.setMutationDefaults(NOTIFICATION_PREF_SAVE, {
    mutationFn: async (vars: PreferenceSaveVars) => {
      if (useAuthStore.getState().user?.userId !== vars.userId) return null;
      return bildirimApi.savePreferences(vars.tercihler);
    },
    networkMode: 'online',
    retry: stationRetry,
    retryDelay: stationRetryDelay,
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(NOTIFICATION_PREFS_KEY, data);
    },
  });
}

/** Aynı kişinin henüz gönderilmemiş (paused) eski taslaklarını düşürür. */
export function dropQueuedPreferenceSaves(userId: string): number {
  const cache = queryClient.getMutationCache();
  const stale = cache.findAll({ mutationKey: NOTIFICATION_PREF_SAVE }).filter((m) => {
    const v = m.state.variables as PreferenceSaveVars | undefined;
    return m.state.isPaused && v?.userId === userId;
  });
  stale.forEach((m) => cache.remove(m));
  return stale.length;
}

export function newPreferenceSave(userId: string, tercihler: PreferenceItem[]): PreferenceSaveVars {
  return { userId, tercihler };
}

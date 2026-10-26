// Tercih ekranının durumu: katalog + çözülmüş hücreler sunucudan; taslak yalnız dokunulan anahtarlar.
// Kayıt kuyruğa girer (çevrimdışı bekler); bayrak kapalı / eski sunucu ekranı "yok" durumuna düşürür.
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useFeatureFlags } from '../../../../hooks/useFeatureFlags';
import { resolveNotificationInboxEnabled } from '../../../../services/featureFlag.service';
import { bildirimApi, httpStatusOf } from '../../../../services/bildirim/bildirimApi';
import { useAuthStore } from '../../../../store/authStore';
import { buildPreferenceBody, editKey, type DraftEdits } from '../../../../lib/bildirim/preferenceDraft';
import {
  NOTIFICATION_PREF_SAVE, NOTIFICATION_PREFS_KEY, dropQueuedPreferenceSaves, newPreferenceSave, type PreferenceSaveVars,
} from '../../../../offline/bildirimMutations';
import type { PreferenceChannel } from '../../../../services/bildirim/types';

export type PreferenceScreenState = 'yukleniyor' | 'kapali' | 'surumde-yok' | 'hata' | 'hazir';

export const NOTIFICATION_CATALOG_KEY = ['bildirim', 'katalog'] as const;

export function useNotificationPreferences() {
  const flags = useFeatureFlags();
  const enabled = resolveNotificationInboxEnabled(flags.data);
  const userId = useAuthStore((s) => s.user?.userId ?? null);
  const catalog = useQuery({ queryKey: NOTIFICATION_CATALOG_KEY, queryFn: bildirimApi.catalog, enabled, retry: false });
  const prefs = useQuery({ queryKey: NOTIFICATION_PREFS_KEY, queryFn: bildirimApi.preferences, enabled, retry: false });
  const [edits, setEdits] = useState<DraftEdits>(() => new Map());
  const save = useMutation<unknown, unknown, PreferenceSaveVars>({ mutationKey: NOTIFICATION_PREF_SAVE });

  const state: PreferenceScreenState = useMemo(() => {
    if (!flags.data && flags.isLoading) return 'yukleniyor';
    if (!enabled) return 'kapali';
    const err = prefs.error ?? catalog.error;
    if (err) {
      const st = httpStatusOf(err);
      if (st === 404) return 'surumde-yok';
      if (st === 409) return 'kapali';
      if (!prefs.data || !catalog.data) return 'hata';
    }
    return prefs.data && catalog.data ? 'hazir' : 'yukleniyor';
  }, [flags.data, flags.isLoading, enabled, prefs.error, prefs.data, catalog.error, catalog.data]);

  const toggle = (kind: string, channel: PreferenceChannel, value: boolean) => {
    setEdits((prev) => new Map(prev).set(editKey(kind, channel), value));
  };

  const submit = () => {
    if (!prefs.data || !userId || edits.size === 0) return;
    dropQueuedPreferenceSaves(userId);
    save.mutate(newPreferenceSave(userId, buildPreferenceBody(prefs.data, edits)), {
      onSuccess: () => setEdits(new Map()),
    });
  };

  return {
    state, catalog: catalog.data ?? [], prefs: prefs.data ?? null, edits, toggle, submit,
    dirty: edits.size > 0, saving: save.isPending && !save.isPaused, queued: save.isPaused, saveError: save.error,
    refetch: () => void Promise.all([prefs.refetch(), catalog.refetch()]),
  };
}

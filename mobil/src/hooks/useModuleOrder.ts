import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { usePermissions } from './usePermission';
import { preferencesService, type PreferenceBlob } from '../services/preferences.service';
import type { MobileScreenKey, MobileScreenMeta } from '../types/permissions';

// Modül grid'i sırası kullanıcı profilinde (backend tercih blob'u) saklanır →
// cihazdan bağımsız. React Query cache'i AsyncStorage'a persist edildiği için
// (App.tsx) kayıtlı sıra app yeniden açıldığında anında uygulanır, sonra
// backend'den tazelenir. Offline'da son bilinen sıra gösterilir.

const PREFS_KEY = ['preferences'] as const;
const ORDER_FIELD = 'mobileModuleOrder';

/**
 * İzinli ekranları kayıtlı sıraya göre dizer. Sırada olmayan (yeni eklenen veya
 * izni sonradan verilen) ekranlar varsayılan sırada SONA eklenir — kullanıcı
 * onları da sürükleyip yerleştirebilir.
 */
function applyOrder(
  screens: MobileScreenMeta[],
  storedKeys: string[] | undefined,
): MobileScreenMeta[] {
  if (!storedKeys || storedKeys.length === 0) return screens;
  const byKey = new Map(screens.map((s) => [s.key, s]));
  const seen = new Set<string>();
  const out: MobileScreenMeta[] = [];
  for (const k of storedKeys) {
    const s = byKey.get(k as MobileScreenKey);
    if (s && !seen.has(k)) {
      out.push(s);
      seen.add(k);
    }
  }
  for (const s of screens) if (!seen.has(s.key)) out.push(s);
  return out;
}

export function useModuleOrder() {
  const { allowedScreens } = usePermissions();
  const qc = useQueryClient();

  const prefsQuery = useQuery({
    queryKey: PREFS_KEY,
    queryFn: preferencesService.get,
    staleTime: 5 * 60 * 1000,
  });

  const storedOrder = useMemo<string[] | undefined>(() => {
    const v = (prefsQuery.data as PreferenceBlob | undefined)?.[ORDER_FIELD];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
  }, [prefsQuery.data]);

  const orderedScreens = useMemo(
    () => applyOrder(allowedScreens, storedOrder),
    [allowedScreens, storedOrder],
  );

  const saveMutation = useMutation({
    // Mevcut blob'u OKU → kendi anahtarımızı merge et → PUT (Electron tercihlerini
    // ezmemek için zorunlu).
    mutationFn: (order: string[]) => {
      const current = qc.getQueryData<PreferenceBlob>(PREFS_KEY) ?? {};
      return preferencesService.save({ ...current, [ORDER_FIELD]: order });
    },
    onMutate: async (order: string[]) => {
      await qc.cancelQueries({ queryKey: PREFS_KEY });
      const prev = qc.getQueryData<PreferenceBlob>(PREFS_KEY);
      qc.setQueryData<PreferenceBlob>(PREFS_KEY, { ...(prev ?? {}), [ORDER_FIELD]: order });
      return { prev };
    },
    onError: (_err, _order, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(PREFS_KEY, ctx.prev);
      Toast.show({
        type: 'error',
        text1: 'Sıralama kaydedilemedi',
        text2: 'Bağlantını kontrol et',
      });
    },
    onSuccess: (data) => qc.setQueryData(PREFS_KEY, data),
  });

  const setModuleOrder = useCallback(
    (order: string[]) => saveMutation.mutate(order),
    [saveMutation],
  );

  return { orderedScreens, setModuleOrder };
}

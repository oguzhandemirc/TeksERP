import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { useVisibleScreens } from './useVisibleScreens';
import { preferencesService, type PreferenceBlob } from '../services/preferences.service';
import { menuLayoutService } from '../services/menuLayout.service';
import { filterHomeGridHidden, filterMenuHidden } from './menuHidden';
import type { MobileScreenKey, MobileScreenMeta } from '../types/permissions';

// Modül grid'i sırası kullanıcı profilinde (backend tercih blob'u) saklanır →
// cihazdan bağımsız. React Query cache'i AsyncStorage'a persist edildiği için
// (App.tsx) kayıtlı sıra app yeniden açıldığında anında uygulanır, sonra
// backend'den tazelenir. Offline'da son bilinen sıra gösterilir.

const PREFS_KEY = ['preferences'] as const;
const ORDER_FIELD = 'mobileModuleOrder';
export const MENU_LAYOUT_KEY = ['menu-layout'] as const;
/** Açık ızgarada menü düzeni tazeleme aralığı (QA 2026-11-03). */
export const MENU_LAYOUT_REFRESH_MS = 60_000;

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

/**
 * K19 menü düzeni: fabrikanın menüden gizlediği ekranlar (route kayıtlı kalır → bağlantı açılır).
 * Uç yok/hata (eski sunucu) → undefined → süzgeç boş = bugünkü grid.
 */
export function useMenuHiddenScreens(): string[] | undefined {
  // Izgara saatlerce açık durur ve odak olayı yok (RN'de focusManager bağlı değil) →
  // paneldeki düzen değişikliği açık tablete ARALIKLA ulaşır, yeniden giriş beklenmez.
  const menuQuery = useQuery({
    queryKey: MENU_LAYOUT_KEY,
    queryFn: menuLayoutService.get,
    staleTime: 5 * 60 * 1000,
    refetchInterval: MENU_LAYOUT_REFRESH_MS,
    retry: false,
  });
  return menuQuery.data?.hiddenScreens;
}

export function useModuleOrder() {
  // Grid'in kaynağı GÖRÜNÜR ekranlar (izin ∖ bayrağı kapalı) — MainNavigator hangi
  // route'ları kaydediyorsa kart da onları gösterir. Gizliyken yapılan sürükleme
  // o anahtarı sıradan düşürür; bayrak sonradan açılınca ekran (izni yeni verilmiş
  // ekran gibi) grid'in SONUNA eklenir ve kullanıcı istediği yere taşır.
  const { visibleScreens } = useVisibleScreens();
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

  const hiddenScreens = useMenuHiddenScreens();

  const orderedScreens = useMemo(
    () => applyOrder(filterMenuHidden(filterHomeGridHidden(visibleScreens), hiddenScreens), storedOrder),
    [visibleScreens, hiddenScreens, storedOrder],
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

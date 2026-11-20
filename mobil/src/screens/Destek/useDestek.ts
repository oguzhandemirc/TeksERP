// Destek görünürlük + rozet hook'ları ve sorgu anahtarı fabrikası ([MO-27]).
// Hata davranışı `destekGorunurluk.ts`te (sessiz yutma, fail-closed).
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  destekService,
  type DestekVisibility,
  type DestekScope,
  type DestekOkunmamis,
} from '../../services/destek.service';
import { useAuthStore } from '../../store/authStore';
import { DESTEK_OFF, safeStatus, okunmamisGuvenli, ROZET_YOKLAMA_MS } from './destekGorunurluk';

export const destekKeys = {
  kok: ['destek'] as const,
  durum: (userId: string) => ['destek', 'durum', userId] as const,
  okunmamis: (scope: DestekScope) => ['destek', 'okunmamis', scope] as const,
  liste: (scope: DestekScope) => ['destek', 'liste', scope] as const,
  talep: (id: string) => ['destek', 'talep', id] as const,
};

/** `/durum` özeti; oturum yoksa / uç yoksa / hata → ikisi de false (hiç görünmez). */
function useDestekVisibility(): DestekVisibility {
  const userId = useAuthStore((s) => s.user?.userId ?? null);
  const q = useQuery({
    queryKey: destekKeys.durum(userId ?? '-'),
    queryFn: () => safeStatus(destekService.durum),
    enabled: !!userId,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return userId && q.data ? q.data : DESTEK_OFF;
}

/** Destek açık mı? Oturum yoksa / uç yoksa / hata → false (hiç görünmez). */
export function useDestekEtkin(): boolean {
  return useDestekVisibility().etkin;
}

/**
 * "Firmanın" sekmesi: sunucunun `/durum.firmaYoneticisi` kararı (tek kaynak, sözleşme §5.1);
 * istemci izinden çıkarım YAPMAZ. Yine de 403 gelirse ekran sekmeyi kapatır.
 */
export function useDestekFirmaYoneticisi(): boolean {
  return useDestekVisibility().firmaYoneticisi;
}

/**
 * Okunmamış rozet — seyrek yoklama (2 dk), YALNIZ uygulama ön plandayken.
 * Hata sessiz yutulur, rozet eski değerinde kalır.
 */
export function useDestekOkunmamis(scope: DestekScope = 'mine'): DestekOkunmamis | undefined {
  const etkin = useDestekEtkin();
  const qc = useQueryClient();
  const key = destekKeys.okunmamis(scope);
  const q = useQuery({
    queryKey: key,
    queryFn: () => {
      const onceki = qc.getQueryData<DestekOkunmamis>(key);
      if (AppState.currentState !== 'active' && onceki) return onceki;
      return okunmamisGuvenli(() => destekService.okunmamis(scope), onceki);
    },
    enabled: etkin,
    refetchInterval: ROZET_YOKLAMA_MS,
    refetchIntervalInBackground: false,
    staleTime: 60_000,
    retry: false,
  });
  return etkin ? q.data : undefined;
}

// Gelen kutusu sorguları — süzme SUNUCUDA (`filter[...]`); istemci yalnız gösterir.
import { useEffect } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { bildirimApi, STRIP_FILTER, TABLET_INBOX_FILTER } from '../services/bildirim/bildirimApi';
import { takeSoundCandidates } from '../services/bildirim/soundGate';
import { INBOX_KEY } from '../services/bildirim/keys';

export const inboxKeys = {
  list: [...INBOX_KEY, 'liste'] as const,
  unread: [...INBOX_KEY, 'okunmamis'] as const,
  strip: [...INBOX_KEY, 'serit'] as const,
};

/** Çekmece listesi: tablet kanalı olan türler, cursor ile. */
export function useInboxList(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: inboxKeys.list,
    queryFn: ({ pageParam }) => bildirimApi.list({ tab: 'tumu', extra: TABLET_INBOX_FILTER, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** Rozet: aynı süzgeçle okunmamış `sayi` (liste ile tek where). */
export function useInboxUnreadCount(enabled: boolean): number {
  const q = useQuery({
    queryKey: inboxKeys.unread,
    queryFn: () => bildirimApi.list({ tab: 'okunmamis', extra: TABLET_INBOX_FILTER, limit: 1 }),
    enabled,
  });
  return q.data?.sayi ?? 0;
}

/** Şerit + ses kaynağı: tablet kanalı açık, okunmamış satırlar. Ses kapısı tekilleştirir. */
export function useStripItems(enabled: boolean) {
  const q = useQuery({
    queryKey: inboxKeys.strip,
    queryFn: () => bildirimApi.list({ tab: 'okunmamis', extra: STRIP_FILTER, limit: 5 }),
    enabled,
  });
  useEffect(() => {
    if (!q.data) return;
    // Tembel: ses modülü (native) başlığı çizen her ekranın yükleme yoluna girmesin.
    if (takeSoundCandidates(q.data.items).length > 0) void import('../services/alarmFeedback').then((m) => m.signalNotification());
  }, [q.data]);
  return q.data?.items ?? [];
}

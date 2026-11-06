// İş Emirleri › Dokuma — hook'lar: başlık anahtarı (görünürlük + cihazda hatırlanan seçim), liste (cursor, süzme sunucuda), genel bakış.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useFeatureFlags } from '../../../../hooks/useFeatureFlags';
import { usePermissions } from '../../../../hooks/usePermission';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { weavingOrderService, type WeavingOrderListRow } from '../../../../services/weavingOrder.service';
import { queryProblem } from '../../../../utils/queryState';
import { storage } from '../../../../utils/storage';
import { DOKUMA_SAYFA, IS_EMRI_TURU_KEY, dokumaAnahtariGorunur, dokumaSorgusu, etkinIsEmriTuru, parseIsEmriTuru, type DokumaFiltre, type IsEmriTuru } from './dokumaListe';

export const DOKUMA_LIST_KEY = ['weaving-orders', 'is-emirleri'] as const;

/**
 * Başlık anahtarının durumu. Bayrağa ABONE olur: rejim sonradan gelirse (önbellek → sunucu) başlık ve TERIM adı
 * yeniden çizilir — ekran bayrak okumadan TERIM'i okusaydı varsayılan "Terbiye" adında kalabilirdi.
 */
export function useIsEmriTuru() {
  const flags = useFeatureFlags().data;
  const { has } = usePermissions();
  const gorunur = dokumaAnahtariGorunur(flags, has);
  const [secili, setSecili] = useState<IsEmriTuru>('terbiye');
  useEffect(() => {
    let alive = true;
    storage.getItem(IS_EMRI_TURU_KEY).then((raw) => alive && setSecili(parseIsEmriTuru(raw))).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const sec = useCallback((t: IsEmriTuru) => {
    setSecili(t);
    void storage.setItem(IS_EMRI_TURU_KEY, t).catch(() => undefined);
  }, []);
  return { gorunur, etkin: etkinIsEmriTuru(secili, gorunur), sec };
}

export function useDokumaListesi(f: DokumaFiltre) {
  const search = useDebouncedValue(f.search, 300);
  const sorgu = useMemo(() => dokumaSorgusu({ ...f, search }), [f, search]);
  const q = useInfiniteQuery({
    queryKey: [...DOKUMA_LIST_KEY, sorgu],
    queryFn: ({ pageParam, signal }) => weavingOrderService.listPage({ ...sorgu, cursor: pageParam, limit: DOKUMA_SAYFA, withTotal: !pageParam }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : undefined),
    placeholderData: keepPreviousData,
  });
  const rows: WeavingOrderListRow[] = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  const loadMore = useCallback(() => {
    if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
  }, [q]);
  return {
    rows,
    total: q.data?.pages[0]?.pagination.totalEstimate,
    problem: rows.length === 0 ? queryProblem(q) : null,
    loading: q.isLoading,
    refreshing: q.isRefetching && !q.isFetchingNextPage,
    fetchingMore: q.isFetchingNextPage,
    searching: f.search !== search || (q.isFetching && q.isPlaceholderData),
    loadMore,
    refetch: q.refetch,
  };
}

export function useDokumaGenelBakis(id: string | null) {
  return useQuery({
    queryKey: ['weaving-orders', 'overview', id],
    queryFn: () => weavingOrderService.overview(id as string),
    enabled: !!id,
  });
}

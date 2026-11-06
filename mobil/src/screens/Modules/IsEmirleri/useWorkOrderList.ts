// İş Emirleri — liste (cursor + sonsuz kaydırma, süzme sunucuda), istasyon seçenekleri ve sütun tercihi hook'ları.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { workOrderService } from '../../../services/workOrder.service';
import { workOrderWhereOptionsService } from '../../../services/workOrderWhereOptions.service';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { queryProblem } from '../../../utils/queryState';
import { useAuthStore } from '../../../store/authStore';
import { storage } from '../../../utils/storage';
import { buildListQuery, PAGE_SIZE, type ListFilters, type WorkOrderListRow } from './workOrderRow';
import { columnsStorageKey, parseStoredColumns, serializeColumns, toggleColumn, DEFAULT_VISIBLE, type ColumnKey } from './columns';

export const WORK_ORDER_LIST_KEY = ['work-orders', 'is-emirleri'] as const;
/** Arama yazılırken istek ~300 ms bekler; yeni harf eski isteği iptal eder (react-query `signal`). */
export const SEARCH_DEBOUNCE_MS = 300;

export function useWorkOrderList(filters: ListFilters) {
  const search = useDebouncedValue(filters.search, SEARCH_DEBOUNCE_MS);
  const query = useMemo(() => buildListQuery({ ...filters, search }), [filters, search]);
  const q = useInfiniteQuery({
    queryKey: [...WORK_ORDER_LIST_KEY, query],
    queryFn: ({ pageParam, signal }) =>
      workOrderService.getAllCursor(
        { limit: PAGE_SIZE, cursor: pageParam, withTotal: !pageParam, search: query.search, filters: query.filters, dateField: query.dateField, dateFrom: query.dateFrom, dateTo: query.dateTo },
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : undefined),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => (q.data?.pages.flatMap((p) => p.data) ?? []) as unknown as WorkOrderListRow[], [q.data]);
  const total = q.data?.pages[0]?.pagination.totalEstimate;
  // Elde veri varken sorun gösterilmez — bayat liste boş ekrandan iyidir.
  const problem = rows.length === 0 ? queryProblem(q) : null;
  // Liste başka ekrandan (istasyon, belge okutma, İE detayı) dönünce tazelenir: RN'de react-query odakta kendiliğinden
  // yenilemez, yeni açılan İE listede görünmüyordu (prova 2026-11-06). İlk odak sorgunun kendi yüklemesidir.
  const qc = useQueryClient();
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void qc.invalidateQueries({ queryKey: WORK_ORDER_LIST_KEY });
    }, [qc]),
  );
  /** Bütün süzgeç varyantlarını bayatlatır, görüneni hemen yeniden çeker (okutmadan dönüş). */
  const refreshAll = useCallback(() => qc.invalidateQueries({ queryKey: WORK_ORDER_LIST_KEY }), [qc]);
  const loadMore = useCallback(() => {
    if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
  }, [q]);
  return {
    rows,
    total,
    problem,
    loading: q.isLoading,
    refreshing: q.isRefetching && !q.isFetchingNextPage,
    fetchingMore: q.isFetchingNextPage,
    searching: filters.search !== search || (q.isFetching && q.isPlaceholderData),
    loadMore,
    refetch: q.refetch,
    refreshAll,
  };
}

/** "Şu an nerede" istasyon süzgeci seçenekleri (sunucu kuralı; eski sunucuda boş). */
export function useLocationStations() {
  const q = useQuery({ queryKey: ['work-orders', 'where-options', 'stations'], queryFn: workOrderWhereOptionsService.get, staleTime: 5 * 60_000 });
  return { stations: q.data?.stations ?? [], loading: q.isLoading };
}

/** Sütun tercihi — kullanıcı başına, cihazda kalıcı. Okunana dek varsayılan gösterilir. */
export function useColumnPrefs() {
  const userId = useAuthStore((s) => s.user?.userId ?? null);
  const key = columnsStorageKey(userId);
  const [visible, setVisible] = useState<ColumnKey[]>([...DEFAULT_VISIBLE]);
  useEffect(() => {
    let alive = true;
    storage
      .getItem(key)
      .then((raw) => alive && setVisible(parseStoredColumns(raw)))
      .catch(() => alive && setVisible(parseStoredColumns(null)));
    return () => {
      alive = false;
    };
  }, [key]);
  const toggle = useCallback(
    (k: ColumnKey) =>
      setVisible((v) => {
        const next = toggleColumn(v, k);
        void storage.setItem(key, serializeColumns(next)).catch(() => undefined);
        return next;
      }),
    [key],
  );
  return { visible, toggle };
}

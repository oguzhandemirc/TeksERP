// Sevk Çıkışı — el terminali v2 listesi (bayrak `shipping.handheldCreateEnabled` açıkken). Açık (PLANNED) ve sevk
// edilmiş sevkiyatlar tek listede, süzgeç/sıralama sunucuda; altta sabit "Yeni Sevk". Açık karta dokun → okutma
// (kaldığı yerden), sevk edilmişe dokun → salt-okunur görünüm.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Appbar, Badge, Text } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQueryClient, type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated from 'react-native-reanimated';
import Toast from 'react-native-toast-message';
import ScreenChrome from '../../../components/ScreenChrome';
import RefreshButton from '../../../components/RefreshButton';
import CollapsibleSearch, { SEARCH_SIBLING_LAYOUT, SearchToggleAction, useCollapsibleSearch } from '../../../components/CollapsibleSearch';
import { SkeletonList } from '../../../components/motion';
import { NoticeStrip } from '../../../components/form';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import { FLAGS_KEY, useShipmentLooseLoadEnabled } from '../../../hooks/useFeatureFlags';
import { handheldShipmentService, type ShipmentListRow } from '../../../services/handheldShipment.service';
import type { MainStackParamList } from '../../../navigation/types';
import { colors, spacing } from '../../../theme';
import FilterSheet from './elSevk/FilterSheet';
import { ShipmentRowCard } from './elSevk/ShipmentRowCard';
import { DEFAULT_LIST_FILTER, HANDHELD_LIST_KEY, activeFilterCount, listQueryKey, listQueryParams, type ListFilter } from './elSevk/listQuery';
import { rowTarget } from './elSevk/listRow';
import { BottomBar, EmptyState, FilledButton, ui } from './elSevk/ui';

type ListQ = UseInfiniteQueryResult<InfiniteData<{ data: ShipmentListRow[] }>, Error>;

function ListBody({ q, items, refresh, filtered, onOpen }: { q: ListQ; items: ShipmentListRow[]; refresh: { refreshing: boolean; onRefresh: () => void }; filtered: boolean; onOpen: (r: ShipmentListRow) => void }) {
  return (
    <>
      {q.isLoading ? (
        <SkeletonList count={6} style={styles.body} />
      ) : q.isError && items.length === 0 ? (
        <View style={styles.error} testID="sevk-liste-hata">
          <Text style={ui.secondary}>{(q.error as Error)?.message || 'Liste alınamadı'}</Text>
          <FilledButton label="Tekrar dene" tone="neutral" icon="refresh" onPress={() => void q.refetch()} />
        </View>
      ) : (
        <FlashList
          data={items}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => <ShipmentRowCard row={item} onPress={onOpen} />}
          contentContainerStyle={styles.body}
          refreshing={refresh.refreshing}
          onRefresh={refresh.onRefresh}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
          }}
          ListEmptyComponent={
            <EmptyState icon="truck-outline" text={filtered ? 'Süzgece uyan sevkiyat yok' : 'Henüz sevkiyat yok'} testID="sevk-liste-bos" />
          }
          ListFooterComponent={q.isFetchingNextPage ? <SkeletonList count={2} /> : null}
        />
      )}
    </>
  );
}

interface HeaderProps {
  searchOpen: boolean;
  onSearch: () => void;
  filterCount: number;
  onFilter: () => void;
  refresh: ReturnType<typeof useManualRefresh>;
}

function HeaderActions({ searchOpen, onSearch, filterCount, onFilter, refresh }: HeaderProps) {
  return (
    <>
        <SearchToggleAction open={searchOpen} onPress={onSearch} testID="sevk-arama-ac" />
        <View>
          <Appbar.Action icon="filter-variant" color={colors.textOnDark} onPress={onFilter} accessibilityLabel="Süzgeç" testID="sevk-suzgec-ac" />
          {filterCount > 0 ? <Badge size={18} style={styles.badge}>{filterCount}</Badge> : null}
        </View>
        <RefreshButton
          headerStyle
          onPress={refresh.onRefresh}
          refreshing={refresh.refreshing}
          isError={refresh.isError}
          errorMessage={refresh.errorMessage}
        />
    </>
  );
}

export default function SevkCikisListe() {
  usePortraitLock(useDeviceType() === 'phone');
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const qc = useQueryClient();
  const search = useCollapsibleSearch();
  const term = useDebouncedValue(search.term, 300);
  const [filter, setFilter] = useState<ListFilter>(DEFAULT_LIST_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);
  // Çuvalsız sevk kapalıyken sunucu yeni sevkiyatı 400 LOOSE_LOAD_DISABLED ile reddeder → çıkışsız düğme gösterilmez.
  const looseLoad = useShipmentLooseLoadEnabled();

  const listQ = useInfiniteQuery({
    queryKey: listQueryKey(filter, term),
    queryFn: ({ pageParam }) => handheldShipmentService.list(listQueryParams(filter, term, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : null),
    staleTime: 10_000,
  });
  const items = useMemo(() => listQ.data?.pages.flatMap((p) => p.data) ?? [], [listQ.data]);

  // Okutma ekranından dönünce liste tazelenir (çıkılan sevkiyat "Açık" kalır, rakamları değişmiş olabilir).
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void qc.invalidateQueries({ queryKey: HANDHELD_LIST_KEY });
    }, [qc]),
  );

  const headerRefresh = useManualRefresh(
    [() => qc.invalidateQueries({ queryKey: FLAGS_KEY }), () => listQ.refetch()],
    'Liste güncellendi',
  );

  const open = (row: ShipmentListRow) => {
    const target = rowTarget(row);
    if (target === 'none') {
      Toast.show({ type: 'info', text1: 'Bu sevkin ayrıntısı panelde' });
      return;
    }
    nav.navigate('SevkOkut', { shipmentId: row.id, shipmentNo: row.shipmentNo });
  };

  const filterCount = activeFilterCount(filter);
  const filtered = filterCount > 0 || term.length > 0;

  return (
    <ScreenChrome
      title="Sevk Çıkışı"
      headerExtras={
        <HeaderActions searchOpen={search.open} onSearch={search.toggle} filterCount={filterCount} onFilter={() => setFilterOpen(true)} refresh={headerRefresh} />
      }
    >
      <CollapsibleSearch open={search.open} value={search.text} onChangeText={search.setText} placeholder="Sevk no, cari ya da çuval ara" testID="sevk-arama-kutu" />
      <Animated.View layout={SEARCH_SIBLING_LAYOUT} style={ui.flex}>
        <ListBody q={listQ} items={items} refresh={headerRefresh} filtered={filtered} onOpen={open} />
      </Animated.View>
      {looseLoad ? null : (
        <View style={styles.notice}>
          <NoticeStrip tone="warn" testID="sevk-dokme-kapali" text="Çuvalsız sevk kapalı. Yeni sevk için panelden açılmalı." />
        </View>
      )}
      <BottomBar>
        <FilledButton label="Yeni Sevk" icon="plus" onPress={() => nav.navigate('SevkCariSec')} disabled={!looseLoad} style={ui.flex} testID="sevk-yeni" />
      </BottomBar>
      <FilterSheet
        visible={filterOpen}
        value={filter}
        onDismiss={() => setFilterOpen(false)}
        onApply={(f) => {
          setFilter(f);
          setFilterOpen(false);
        }}
      />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },
  badge: { position: 'absolute', top: 4, right: 4, backgroundColor: colors.warning },
  error: { alignItems: 'center', gap: spacing.md, padding: spacing.xxl },
  notice: { paddingHorizontal: spacing.lg },
});

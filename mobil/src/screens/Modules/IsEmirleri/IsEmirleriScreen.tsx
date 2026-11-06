// =============================================================================
// İş Emirleri (tablet/telefon) — liste + "şu an nerede"; arama/süzme SUNUCUDA, cursor + sonsuz kaydırma.
// İnce kabuk: süzgeç durumu + sayfa değişimi; liste/hook/saf mantık ayrı dosyalarda.
// =============================================================================
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import ScreenChrome from '../../../components/ScreenChrome';
import { TERIM } from '../../../lib/terim';
import { colors, spacing, typography } from '../../../theme';
import WorkOrderDetailSheet from '../HizliIsEmri/WorkOrderDetailSheet';
import ColumnsSheet from './ColumnsSheet';
import FilterBar from './FilterBar';
import WorkOrderTable from './WorkOrderTable';
import { useColumnPrefs, useLocationStations, useWorkOrderList } from './useWorkOrderList';
import { activeFilterCount, DEFAULT_FILTERS, MIN_SEARCH, type ListFilters } from './workOrderRow';

export default function IsEmirleriScreen() {
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useWorkOrderList(filters);
  const { stations, loading: stationsLoading } = useLocationStations();
  const cols = useColumnPrefs();
  const filtered = filters.search.trim().length >= MIN_SEARCH || activeFilterCount(filters) > 0;

  return (
    <ScreenChrome title={TERIM.terbiyeIsEmri.cogul}>
      <View style={styles.fill}>
        <FilterBar value={filters} onChange={setFilters} stations={stations} stationsLoading={stationsLoading} searching={list.searching} onColumns={() => setColumnsOpen(true)} />
        <Text style={styles.total} testID="ie-liste-toplam">
          {list.total != null ? `${list.total.toLocaleString('tr-TR')} kayıt` : ' '}
          {filters.search.trim().length > 0 && filters.search.trim().length < MIN_SEARCH ? ` · aramak için en az ${MIN_SEARCH} harf` : ''}
        </Text>
        <WorkOrderTable
          rows={list.rows}
          visible={cols.visible}
          loading={list.loading}
          problem={list.problem}
          filtered={filtered}
          refreshing={list.refreshing}
          fetchingMore={list.fetchingMore}
          onEndReached={list.loadMore}
          onRefresh={() => void list.refetch()}
          onRetry={() => void list.refetch()}
          onOpen={setOpenId}
        />
      </View>
      <ColumnsSheet visible={columnsOpen} columns={cols.visible} onToggle={cols.toggle} onDismiss={() => setColumnsOpen(false)} />
      <WorkOrderDetailSheet workOrderId={openId} onClose={() => setOpenId(null)} onChanged={() => void list.refetch()} />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.appBg },
  total: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xs, fontSize: typography.size.sm, color: colors.textSecondary },
});

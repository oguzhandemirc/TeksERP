// =============================================================================
// İş Emirleri (tablet/telefon) — liste + "şu an nerede"; arama/süzme SUNUCUDA, cursor + sonsuz kaydırma.
// İnce kabuk: süzgeç durumu + sayfa değişimi; liste/hook/saf mantık ayrı dosyalarda.
// =============================================================================
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import ScreenChrome from '../../../components/ScreenChrome';
import { TERIM } from '../../../lib/terim';
import { colors } from '../../../theme';
import WorkOrderDetailSheet from '../HizliIsEmri/WorkOrderDetailSheet';
import ColumnsSheet from './ColumnsSheet';
import FilterBar from './FilterBar';
import WorkOrderTable from './WorkOrderTable';
import ActionBar from './ActionBar';
import ScanStage from './ScanStage';
import OptionsSheet from './OptionsSheet';
import { KIND_BUTTON } from './scanFlow';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import type { WoCreateKind } from '../../../store/woCreateKinds';
import { useScanAction } from './useScanAction';
import { shortcutTitle } from '../GelenBelge/woCreate/woFromDoc';
import type { ProductionRoute } from '../../../services/route.service';
import { useColumnPrefs, useLocationStations, useWorkOrderList } from './useWorkOrderList';
import { DEFAULT_FILTERS, emptyStateFor, type ListFilters } from './workOrderRow';

export default function IsEmirleriScreen() {
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [scanRoute, setScanRoute] = useState<{ route: ProductionRoute; kind: WoCreateKind } | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const kinds = useDeviceSettingsStore((s) => s.woCreateKinds);
  const setKinds = useDeviceSettingsStore((s) => s.setWoCreateKinds);
  const scan = useScanAction();
  const list = useWorkOrderList(filters);
  const { stations, loading: stationsLoading } = useLocationStations();
  const cols = useColumnPrefs();

  if (scanRoute) {
    // Okutma: DocBatchView akışı (BELGE kipinde de); geri → liste (kaydedilen İE listede görünsün diye tazelenir).
    const back = () => { setScanRoute(null); void list.refetch(); };
    return (
      <ScreenChrome title={`${KIND_BUTTON[scanRoute.kind]} · ${shortcutTitle(scanRoute.route)}`} onStepBack={back}>
        <ScanStage route={scanRoute.route} kind={scanRoute.kind} onCancel={back} />
      </ScreenChrome>
    );
  }

  return (
    <ScreenChrome title={TERIM.terbiyeIsEmri.cogul}>
      <View style={styles.fill}>
        <FilterBar value={filters} onChange={setFilters} stations={stations} stationsLoading={stationsLoading} searching={list.searching} onColumns={() => setColumnsOpen(true)} onOptions={scan.available ? () => setOptionsOpen(true) : undefined} />
        <WorkOrderTable
          rows={list.rows}
          visible={cols.visible}
          loading={list.loading}
          problem={list.problem}
          empty={emptyStateFor(filters)}
          refreshing={list.refreshing}
          fetchingMore={list.fetchingMore}
          onEndReached={list.loadMore}
          onRefresh={() => void list.refetch()}
          onRetry={() => void list.refetch()}
          onOpen={setOpenId}
          onEmptyAction={(a) => setFilters(a === 'clearFilters' ? DEFAULT_FILTERS : { ...filters, status: 'ALL' })}
        />
        {scan.available && <ActionBar groups={scan.groups} type={scan.type} loading={scan.loading} onSelect={scan.select} kinds={kinds} onScan={(kind) => scan.type && setScanRoute({ route: scan.type, kind })} />}
      <OptionsSheet visible={optionsOpen} kinds={kinds} onChange={(k) => void setKinds(k)} onDismiss={() => setOptionsOpen(false)} />
      </View>
      <ColumnsSheet visible={columnsOpen} columns={cols.visible} onToggle={cols.toggle} onDismiss={() => setColumnsOpen(false)} />
      <WorkOrderDetailSheet workOrderId={openId} onClose={() => setOpenId(null)} onChanged={() => void list.refetch()} />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.appBg },
});

// =============================================================================
// İş Emirleri (tablet/telefon) — liste + "şu an nerede"; arama/süzme SUNUCUDA, cursor + sonsuz kaydırma.
// İnce kabuk: süzgeç durumu + sayfa değişimi; liste/hook/saf mantık ayrı dosyalarda.
// =============================================================================
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
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
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { useScanAction } from './useScanAction';
import type { ProductionRoute } from '../../../services/route.service';
import { buttonRouteFor, initialFormRoute } from './createEntry';
import { useColumnPrefs, useLocationStations, useWorkOrderList } from './useWorkOrderList';
import { DEFAULT_FILTERS, emptyStateFor, type ListFilters } from './workOrderRow';
import IsEmriTuruAnahtari from './dokuma/IsEmriTuruAnahtari';
import DokumaListesi from './dokuma/DokumaListesi';
import { useIsEmriTuru } from './dokuma/useDokumaListesi';

export default function IsEmirleriScreen() {
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [stage, setStage] = useState<{ route: ProductionRoute | null; manual: boolean; n: number } | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const kinds = useDeviceSettingsStore((s) => s.woCreateKinds);
  const setKinds = useDeviceSettingsStore((s) => s.setWoCreateKinds);
  const routeOnButton = useDeviceSettingsStore((s) => s.woRouteOnButton);
  const setRouteOnButton = useDeviceSettingsStore((s) => s.setWoRouteOnButton);
  const woButtons = useDeviceSettingsStore((s) => s.woButtons);
  const setWoButtons = useDeviceSettingsStore((s) => s.setWoButtons);
  // Tek mal sahibi açıksa formda sorulmaz; hangi türle açılacağı tuşlarda etiketle görünür.
  const kindTag = kinds.length === 1 ? (kinds[0] === 'CUSTOMER_GOODS' ? { label: 'Müşteri malı', fason: true } : { label: 'Bizim mal', fason: false }) : null;
  const scan = useScanAction(routeOnButton);
  // Ayar kapalıyken tuştaki rota forma (ve yüke) HİÇ geçmez; kart rotası formda çözülür.
  const open = (manual: boolean) => setStage({ route: initialFormRoute({ buttonRoute: buttonRouteFor(routeOnButton, scan.type), cardRoute: null, scanMode: scan.scanMode === true }), manual, n: Date.now() });
  const list = useWorkOrderList(filters);
  const refresh = useManualRefresh(() => list.refetch(), 'İş emirleri güncellendi');
  const { stations, loading: stationsLoading } = useLocationStations();
  const cols = useColumnPrefs();
  // Terbiye | Dokuma: dokuma rejimi kapalıysa (ya da okuma izni yoksa) anahtar yok, başlık bugünkü düz metin.
  const tur = useIsEmriTuru();
  const anahtar = tur.gorunur ? <IsEmriTuruAnahtari etkin={tur.etkin} onSec={tur.sec} /> : undefined;

  if (stage) {
    // Oluşturma formu; geri → liste (kaydedilen İE listede görünsün diye tazelenir).
    const back = () => { setStage(null); void list.refreshAll(); };
    return (
      <ScreenChrome title={stage.manual ? `${TERIM.terbiyeIsEmri.tekil} · Elle oluştur` : `${TERIM.terbiyeIsEmri.tekil} · Belge okut`} onStepBack={back}>
        <ScanStage key={stage.n} route={stage.route} kinds={kinds} manual={stage.manual} onCancel={back} onNew={() => setStage({ ...stage, n: stage.n + 1 })} />
      </ScreenChrome>
    );
  }

  if (tur.etkin === 'dokuma') {
    // Dokuma yalnız izlenir (oluşturma panelde): alt çubuk yok — "Okut" terbiye belgesi akışıdır.
    return (
      <ScreenChrome title="" titleRowExtras={anahtar}>
        <DokumaListesi />
      </ScreenChrome>
    );
  }

  return (
    <ScreenChrome title={anahtar ? '' : TERIM.terbiyeIsEmri.cogul} titleRowExtras={anahtar}>
      <View style={styles.fill}>
        <FilterBar value={filters} onChange={setFilters} stations={stations} stationsLoading={stationsLoading} searching={list.searching} onColumns={() => setColumnsOpen(true)} onOptions={scan.available ? () => setOptionsOpen(true) : undefined} />
        <WorkOrderTable
          rows={list.rows}
          visible={cols.visible}
          loading={list.loading}
          problem={list.problem}
          empty={emptyStateFor(filters)}
          refreshing={refresh.refreshing}
          fetchingMore={list.fetchingMore}
          onEndReached={list.loadMore}
          onRefresh={refresh.onRefresh}
          onRetry={() => void list.refetch()}
          onOpen={setOpenId}
          onEmptyAction={(a) => setFilters(a === 'clearFilters' ? DEFAULT_FILTERS : { ...filters, status: 'ALL' })}
        />
        {scan.available && <ActionBar groups={scan.groups} type={scan.type} loading={scan.loading} onSelect={scan.select} showRoute={routeOnButton} onScan={() => open(false)} onManual={() => open(true)} buttons={woButtons} kindTag={kindTag} />}
        <OptionsSheet visible={optionsOpen} kinds={kinds} onChange={(k) => void setKinds(k)} routeOnButton={routeOnButton} onRouteOnButton={(v) => void setRouteOnButton(v)} buttons={woButtons} onButtons={(v) => void setWoButtons(v)} onDismiss={() => setOptionsOpen(false)} />
      </View>
      <ColumnsSheet visible={columnsOpen} columns={cols.visible} onToggle={cols.toggle} onDismiss={() => setColumnsOpen(false)} />
      <WorkOrderDetailSheet workOrderId={openId} onClose={() => setOpenId(null)} onChanged={() => void list.refetch()} />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.appBg },
});

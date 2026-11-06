import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Surface,
  Text,
  Button,
  TextInput,
  ActivityIndicator,
  Appbar,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import AppModal from '../../../components/AppModal';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ScreenChrome from '../../../components/ScreenChrome';
import RefreshButton from '../../../components/RefreshButton';
import { packingService, type SackStoreShipmentLite } from '../../../services/packing.service';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import { FLAGS_KEY, useFeatureFlags, useShipmentLooseLoadEnabled } from '../../../hooks/useFeatureFlags';
import type { MainStackParamList } from '../../../navigation/types';
import SackContentsModal from './SackContentsModal';
import ShipmentCancelModal from './ShipmentCancelModal';
import { CariHoldBlockedScreen, cariHoldBlockFromError, type CariHoldBlock } from './CariHold';
import { BoardEmpty, ShipmentBoardCard, fmtM } from './ShipmentBoardCard';
import { boardUnitText } from '../../../lib/loadUnit';
import { READY_WORKS_KEY, ReadyWorksSheet, ReadyWorksStrip } from './ReadyWorks';
import { LoadAddFlow } from './LoadAddFlow';
import { LoadPreviewCard } from './LoadPreviewCard';
import { useLooseRollRemove } from './LooseRollRemove';
import type { ReadyWorkRow } from '../../../services/readyWorks.service';
import { showScreenError } from '../../../lib/screenToast';
import TruncatedText from '../../../components/TruncatedText';

// =============================================================================
// Sevk Kapısı — havuzdan kurulmuş, sevk bekleyen PLANNED sevkiyatlar. Sevk onayı
// açıkken kurulan (veya kapalıyken kurulup henüz sevk edilmemiş) sevkiyatlar burada
// dispatch edilir — kapı önü ara adımı YOK; PLANNED → tek "Sevk Et" ile DISPATCHED.
// HAFİF board: FlashList + cursor sonsuz kaydırma + sunucu araması. Kart özet;
// çuval+rulo dökümü karta tıklayınca lazy (SackContentsModal). PLANNED'da çuval
// çıkarılabilir (havuza döner). Stok yalnız çıkışta (dispatch) düşer.
// =============================================================================

const PAGE_SIZE = 30;

export default function SevkiyatScreen() {
  usePortraitLock(useDeviceType() === 'phone');
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  const [contentsShip, setContentsShip] = useState<SackStoreShipmentLite | null>(null);
  const [dispatchShip, setDispatchShip] = useState<SackStoreShipmentLite | null>(null);
  const [cancelShip, setCancelShip] = useState<SackStoreShipmentLite | null>(null);
  const [addShip, setAddShip] = useState<SackStoreShipmentLite | null>(null);
  const looseRemove = useLooseRollRemove();
  // D4-I4: 409 CARI_HOLD → tam ekran (metin sunucudan); diğer hatalar tost.
  const [holdBlock, setHoldBlock] = useState<CariHoldBlock | null>(null);
  // D4-J4: hazır iş çipine dokunulan müşteri (liste lazy; sevk mevcut Paketleme akışından).
  const [readyCustomer, setReadyCustomer] = useState<ReadyWorkRow | null>(null);
  const incomingDocsEnabled = useFeatureFlags().data?.gelenBelgeEnabled === true;
  const looseLoadEnabled = useShipmentLooseLoadEnabled();
  const [plate, setPlate] = useState('');
  const [driver, setDriver] = useState('');
  const [carrier, setCarrier] = useState('');

  // HAFİF board — cursor sonsuz kaydırma + server arama. Board yalnız PLANNED döner.
  const listQ = useInfiniteQuery({
    queryKey: ['sack-store', 'board', debouncedSearch] as const,
    queryFn: ({ pageParam }) =>
      packingService.listSackStoreBoard({
        search: debouncedSearch || undefined,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : null),
    staleTime: 10_000,
  });
  const items = useMemo(() => listQ.data?.pages.flatMap((p) => p.data) ?? [], [listQ.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['sack-store'] });
    void qc.invalidateQueries({ queryKey: ['sack-contents'] });
  };
  const headerRefresh = useManualRefresh(
    [() => qc.invalidateQueries({ queryKey: FLAGS_KEY }), () => listQ.refetch(), () => qc.invalidateQueries({ queryKey: READY_WORKS_KEY })],
    'Liste güncellendi',
  );

  const dispatchMut = useMutation({
    mutationFn: (id: string) =>
      packingService.dispatch(id, {
        plateNumber: plate.trim() || null,
        driverName: driver.trim() || null,
        carrier: carrier.trim() || null,
      }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Çıkış verildi — stok bina dışı' });
      setDispatchShip(null);
      setPlate('');
      setDriver('');
      setCarrier('');
      refresh();
      // Sevk edilen toplar hazır iş çiplerinden düşsün (staleTime beklenmesin).
      void qc.invalidateQueries({ queryKey: READY_WORKS_KEY });
    },
    // L fix: 409'da (baska operator ayni sevkiyati degistirdi) board tazelensin.
    onError: (e: Error) => {
      const block = cariHoldBlockFromError(e);
      if (block) {
        setDispatchShip(null);
        setHoldBlock(block);
      } else showScreenError(e, 'Sevk edilemedi');
      refresh();
    },
  });

  // Çuval çıkar (PLANNED) → havuza döner. Modal içindeki çuval başlıklarından tetiklenir.
  const removeSackMut = useMutation({
    mutationFn: ({ shipmentId, sackId }: { shipmentId: string; sackId: string }) =>
      packingService.removeSackFromShipment(shipmentId, sackId),
    onSuccess: (res, variables) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Çuval çıkarıldı', text2: res.message });
      void qc.invalidateQueries({ queryKey: ['sack-contents', variables.shipmentId] });
      refresh();
    },
    onError: (e: Error) => {
      showScreenError(e, 'Çuval çıkarılamadı');
      void qc.invalidateQueries({ queryKey: ['sack-contents'] });
      refresh();
    },
  });

  // PLANLI'da girilmiş araç bilgisiyle dolar — boş gönderim kayıtlı plakayı sessizce silmesin.
  const openDispatch = (sh: SackStoreShipmentLite) => {
    setDispatchShip(sh);
    setPlate(sh.plateNumber ?? '');
    setDriver(sh.driverName ?? '');
    setCarrier(sh.carrier ?? '');
  };

  const busy = dispatchMut.isPending;

  const renderCard = ({ item: sh }: { item: SackStoreShipmentLite }) => (
    <ShipmentBoardCard sh={sh} busy={busy} onContents={setContentsShip} onCancel={setCancelShip} onDispatch={openDispatch} onAdd={setAddShip} />
  );

  return (
    <ScreenChrome
      title="Sevk Çıkışı"
      headerExtras={
        <>
          <RefreshButton
            headerStyle
            onPress={headerRefresh.onRefresh}
            refreshing={headerRefresh.refreshing}
            isError={headerRefresh.isError}
            errorMessage={headerRefresh.errorMessage}
            successMessage={headerRefresh.successMessage}
          />
          <Appbar.Action
            icon="history"
            color="#fff"
            onPress={() => nav.navigate('SevkiyatGecmisi')}
            accessibilityLabel="Sevkiyat geçmişi"
          />
        </>
      }
    >
      <View style={styles.filters}>
        <TextInput
          mode="outlined"
          placeholder="Çuval kodu, sevk no veya müşteri ara..."
          value={search}
          onChangeText={setSearch}
          left={<TextInput.Icon icon="magnify" />}
        />
      </View>
      <ReadyWorksStrip onOpen={setReadyCustomer} />

      <View style={{ flex: 1 }}>
        <FlashList
          data={items}
          keyExtractor={(s) => s.id}
          renderItem={renderCard}
          contentContainerStyle={styles.body}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (listQ.hasNextPage && !listQ.isFetchingNextPage) listQ.fetchNextPage();
          }}
          ListEmptyComponent={<BoardEmpty q={listQ} search={debouncedSearch} />}
          ListFooterComponent={
            listQ.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: 16 }} /> : null
          }
        />
      </View>

      {/* Çuval + rulo dökümü (lazy) — PLANNED sevkiyatta çuval çıkarma butonlu */}
      <SackContentsModal
        shipment={contentsShip}
        onDismiss={() => setContentsShip(null)}
        onRemoveSack={
          contentsShip
            ? (sackId) => {
                if (contentsShip) removeSackMut.mutate({ shipmentId: contentsShip.id, sackId });
              }
            : undefined
        }
        removing={removeSackMut.isPending || looseRemove.removing}
        onRemoveLooseRoll={
          contentsShip
            ? (rollId, barcode, unitTitle, last) => looseRemove.ask({ shipmentId: contentsShip.id, rollId, barcode, unitTitle, last })
            : undefined
        }
      />
      {looseRemove.modal}
      <LoadAddFlow shipment={addShip} onDismiss={() => setAddShip(null)} />

      {/* Bekleyen sevkiyatı iptal — önizlemeli; storno (sevk edilmiş) tablette yok. */}
      <ShipmentCancelModal
        shipment={cancelShip}
        onDismiss={() => setCancelShip(null)}
        onDone={() => {
          setCancelShip(null);
          refresh();
          void qc.invalidateQueries({ queryKey: READY_WORKS_KEY });
        }}
      />

      {/* Sevk çıkışı — plaka/şoför opsiyonel */}
      <AppModal visible={dispatchShip !== null} onDismiss={() => setDispatchShip(null)}>
        <Surface style={styles.sheet} elevation={4}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            {dispatchShip?.shipmentNo} — Sevk Et
          </Text>
          <TruncatedText style={styles.customer} revealOnTap>
            {dispatchShip?.customer.name} · {dispatchShip ? boardUnitText(dispatchShip) : ''} ·{' '}
            {dispatchShip ? fmtM(dispatchShip.totalQty) : '0'}m
          </TruncatedText>
          {/* 9.1: hangi İE'nin kaç topu, eksik var mı, karışık müşteri — engellemez, uyarır. */}
          <LoadPreviewCard shipmentId={dispatchShip?.id ?? null} />
          <TextInput mode="outlined" label="Plaka" value={plate} onChangeText={setPlate} autoCapitalize="characters" style={{ marginTop: 12 }} />
          <TextInput mode="outlined" label="Şoför" value={driver} onChangeText={setDriver} style={{ marginTop: 8 }} />
          <TextInput mode="outlined" label="Taşıyıcı (opsiyonel)" value={carrier} onChangeText={setCarrier} style={{ marginTop: 8 }} />
          <View style={styles.actions}>
            <Button onPress={() => setDispatchShip(null)} style={styles.actionBtn}>
              İptal
            </Button>
            <Button
              mode="contained"
              icon="truck-check"
              buttonColor="#16a34a"
              style={styles.actionBtn}
              loading={dispatchMut.isPending}
              disabled={dispatchMut.isPending}
              onPress={() => {
                if (dispatchShip) dispatchMut.mutate(dispatchShip.id);
              }}
            >
              Çıkışı Onayla
            </Button>
          </View>
        </Surface>
      </AppModal>
      <ReadyWorksSheet
        customer={readyCustomer}
        incomingDocsEnabled={incomingDocsEnabled}
        looseLoadEnabled={looseLoadEnabled}
        onDismiss={() => setReadyCustomer(null)}
        onGoPacking={(customerId) => {
          setReadyCustomer(null);
          nav.navigate('Paketleme', { customerId });
        }}
      />
      <CariHoldBlockedScreen block={holdBlock} onClose={() => setHoldBlock(null)} />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  filters: { padding: 12, gap: 8, backgroundColor: '#fff' },
  body: { padding: 12, paddingBottom: 24 },
  customer: { fontSize: 13, color: '#334155', marginTop: 2 },
  sheet: { borderRadius: 16, padding: 16, backgroundColor: '#fff', alignSelf: 'stretch' },
  sheetTitle: { fontWeight: '700', marginBottom: 4, color: '#0f172a' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1 },
});

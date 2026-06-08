import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Surface,
  Text,
  Button,
  TextInput,
  ActivityIndicator,
  TouchableRipple,
  Appbar,
  Icon,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import AppModal from '../../../components/AppModal';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import dayjs from 'dayjs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ScreenChrome from '../../../components/ScreenChrome';
import RefreshButton from '../../../components/RefreshButton';
import { packingService, type SackStoreShipmentLite } from '../../../services/packing.service';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import { useShipmentConfirmationEnabled, FLAGS_KEY } from '../../../hooks/useFeatureFlags';
import type { MainStackParamList } from '../../../navigation/types';
import SackContentsModal from './SackContentsModal';

// =============================================================================
// Çuval Depo & Çıkış — çuvallanmış bekleyen mal (READY=çuval depo, AT_DOOR=kapı
// önü). HAFİF board: FlashList + cursor sonsuz kaydırma + sunucu araması/durum
// filtresi (yüzlerce sevk birikse de "hepsini çek/render" YOK). Kart özet; çuval
// + rulo dökümü karta tıklayınca lazy (SackContentsModal). Stok yalnız çıkışta düşer.
// =============================================================================

const PAGE_SIZE = 30;
type StatusFilter = 'ALL' | 'READY' | 'AT_DOOR';
const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'ALL', label: 'Tümü' },
  { key: 'READY', label: 'Çuval Depo' },
  { key: 'AT_DOOR', label: 'Kapı Önü' },
];

const fmtM = (m: number) => m.toLocaleString('tr-TR', { maximumFractionDigits: 2 });

function waitText(readyAt: string | null): string | null {
  if (!readyAt) return null;
  const mins = dayjs().diff(dayjs(readyAt), 'minute');
  if (mins < 60) return 'az önce';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} saattir`;
  return `${Math.floor(hours / 24)} gündür`;
}

export default function SevkiyatScreen() {
  usePortraitLock(useDeviceType() === 'phone');
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const qc = useQueryClient();
  const confirmRequired = useShipmentConfirmationEnabled();

  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  const [contentsShip, setContentsShip] = useState<SackStoreShipmentLite | null>(null);
  const [dispatchShip, setDispatchShip] = useState<SackStoreShipmentLite | null>(null);
  const [unreadyShip, setUnreadyShip] = useState<SackStoreShipmentLite | null>(null);
  const [plate, setPlate] = useState('');
  const [driver, setDriver] = useState('');
  const [carrier, setCarrier] = useState('');

  // HAFİF board — cursor sonsuz kaydırma + server arama/durum filtresi.
  const listQ = useInfiniteQuery({
    queryKey: ['sack-store', 'board', status, debouncedSearch] as const,
    queryFn: ({ pageParam }) =>
      packingService.listSackStoreBoard({
        status: status === 'ALL' ? undefined : status,
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
    [() => qc.invalidateQueries({ queryKey: FLAGS_KEY }), () => listQ.refetch()],
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
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Sevk edilemedi', text2: e.message }),
  });

  const moveToDoorMut = useMutation({
    mutationFn: (id: string) => packingService.moveToDoor(id),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Kapı önüne kondu', text2: res.message });
      refresh();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Kapı önüne konamadı', text2: e.message }),
  });

  const pullBackMut = useMutation({
    mutationFn: (id: string) => packingService.pullBackFromDoor(id),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Çuval depoya geri çekildi', text2: res.message });
      refresh();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Geri çekilemedi', text2: e.message }),
  });

  const unreadyMut = useMutation({
    mutationFn: (id: string) => packingService.unready(id),
    onSuccess: (_res, id) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Hazırlığa geri alındı', text2: 'Düzenlemek için paketleme açıldı' });
      setUnreadyShip(null);
      refresh();
      nav.navigate('Paketleme', { shipmentId: id });
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Geri alınamadı', text2: e.message }),
  });

  const openDispatch = (sh: SackStoreShipmentLite) => {
    setDispatchShip(sh);
    setPlate('');
    setDriver('');
    setCarrier('');
  };

  const busy = dispatchMut.isPending || moveToDoorMut.isPending || pullBackMut.isPending;

  const renderCard = ({ item: sh }: { item: SackStoreShipmentLite }) => {
    const wait = waitText(sh.readyAt);
    const isReady = sh.status === 'READY';
    return (
      <Surface style={styles.card} elevation={1}>
        <View style={styles.cardHead}>
          <View style={styles.titleWrap}>
            <Text style={styles.shipNo}>{sh.shipmentNo}</Text>
            <View style={[styles.statusChip, isReady ? styles.chipReady : styles.chipDoor]}>
              <Text style={[styles.statusChipText, { color: isReady ? '#7c3aed' : '#b45309' }]}>
                {isReady ? 'Çuval Depo' : 'Kapı Önü'}
              </Text>
            </View>
          </View>
          <Text style={styles.meta}>
            {sh.sackCount} çuval · {fmtM(sh.totalQty)}m · {sh.totalKg.toLocaleString('tr-TR')} kg
          </Text>
        </View>
        <View style={styles.customerRow}>
          <Text style={[styles.customer, styles.customerFlex]} numberOfLines={1}>
            {sh.customer.name}
            {sh.branch ? ` · ${sh.branch.name}` : ''}
          </Text>
          {wait ? <Text style={styles.waitText}>⏳ {wait}</Text> : null}
        </View>

        {/* İçeriği gör — tıklayınca çuval+rulo dökümü lazy gelir */}
        <TouchableRipple onPress={() => setContentsShip(sh)} style={styles.contentsBtn}>
          <View style={styles.contentsRow}>
            <Icon source="sack" size={15} color="#4338ca" />
            <Text style={styles.contentsText}>{sh.rollCount} top · çuval içeriğini gör</Text>
            <Icon source="chevron-right" size={18} color="#94a3b8" />
          </View>
        </TouchableRipple>

        {/* Durum bazlı aksiyonlar */}
        <View style={styles.cardActions}>
          {isReady ? (
            <>
              <Button
                mode="outlined"
                icon="pencil"
                textColor="#b45309"
                onPress={() => setUnreadyShip(sh)}
                disabled={busy}
                style={styles.actBtn}
              >
                Geri Al
              </Button>
              {confirmRequired ? (
                <Button
                  mode="contained"
                  icon="truck-fast"
                  buttonColor="#7c3aed"
                  onPress={() => moveToDoorMut.mutate(sh.id)}
                  disabled={busy}
                  style={styles.actBtn}
                >
                  Kapı Önüne
                </Button>
              ) : (
                <Button
                  mode="contained"
                  icon="truck-check"
                  buttonColor="#16a34a"
                  onPress={() => openDispatch(sh)}
                  disabled={busy}
                  style={styles.actBtn}
                >
                  Sevk Et
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                mode="outlined"
                icon="arrow-left"
                onPress={() => pullBackMut.mutate(sh.id)}
                disabled={busy}
                style={styles.actBtn}
              >
                Geri Çek
              </Button>
              <Button
                mode="contained"
                icon="truck-check"
                buttonColor="#16a34a"
                onPress={() => openDispatch(sh)}
                disabled={busy}
                style={styles.actBtn}
              >
                Alındı
              </Button>
            </>
          )}
        </View>
      </Surface>
    );
  };

  return (
    <ScreenChrome
      title="Çuval Depo & Çıkış"
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
          dense
          placeholder="Çuval kodu, sevk no veya müşteri ara..."
          value={search}
          onChangeText={setSearch}
          left={<TextInput.Icon icon="magnify" />}
        />
        <View style={styles.statusRow}>
          {STATUS_TABS.map((t) => (
            <Button
              key={t.key}
              compact
              mode={status === t.key ? 'contained' : 'outlined'}
              onPress={() => setStatus(t.key)}
              style={styles.statusBtn}
            >
              {t.label}
            </Button>
          ))}
        </View>
      </View>

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
          ListEmptyComponent={
            listQ.isLoading ? (
              <ActivityIndicator style={{ marginTop: 24 }} />
            ) : (
              <Text style={styles.emptySub}>
                {debouncedSearch ? 'Aramayla eşleşen sevk yok.' : 'Bekleyen çuval yok.'}
              </Text>
            )
          }
          ListFooterComponent={
            listQ.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: 16 }} /> : null
          }
        />
      </View>

      {/* Çuval + rulo dökümü (lazy) */}
      <SackContentsModal shipment={contentsShip} onDismiss={() => setContentsShip(null)} />

      {/* Çıkış / Alındı — plaka/şoför opsiyonel */}
      <AppModal visible={dispatchShip !== null} onDismiss={() => setDispatchShip(null)}>
        <Surface style={styles.sheet} elevation={4}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            {dispatchShip?.shipmentNo} — {confirmRequired ? 'Alındı / Çıkış' : 'Sevk Et'}
          </Text>
          <Text style={styles.customer}>
            {dispatchShip?.customer.name} · {dispatchShip?.sackCount} çuval ·{' '}
            {dispatchShip ? fmtM(dispatchShip.totalQty) : '0'}m
          </Text>
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

      {/* Çuval depodan hazırlığa geri al — düzenleme */}
      <AppModal visible={unreadyShip !== null} onDismiss={() => setUnreadyShip(null)}>
        <Surface style={styles.sheet} elevation={4}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            {unreadyShip?.shipmentNo} — Hazırlığa Geri Al
          </Text>
          <Text style={styles.customer}>
            {unreadyShip?.customer.name}
            {unreadyShip?.branch ? ` · ${unreadyShip.branch.name}` : ''} · {unreadyShip?.sackCount} çuval
          </Text>
          <Text style={styles.unreadyHint}>
            Çuval depodan çıkar, paketlemeye döner — top ekleyebilir/çıkarabilirsin. Karşılanma geri
            alınır (stok düşmediği için güvenli); istediğinde tekrar çuval depoya kaldırırsın.
          </Text>
          <View style={styles.actions}>
            <Button onPress={() => setUnreadyShip(null)} style={styles.actionBtn}>
              Vazgeç
            </Button>
            <Button
              mode="contained"
              icon="pencil"
              buttonColor="#b45309"
              style={styles.actionBtn}
              loading={unreadyMut.isPending}
              disabled={unreadyMut.isPending}
              onPress={() => {
                if (unreadyShip) unreadyMut.mutate(unreadyShip.id);
              }}
            >
              Geri Al
            </Button>
          </View>
        </Surface>
      </AppModal>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  filters: { padding: 12, gap: 8, backgroundColor: '#fff' },
  statusRow: { flexDirection: 'row', gap: 8 },
  statusBtn: { flex: 1 },
  body: { padding: 12, paddingBottom: 24 },
  card: { borderRadius: 12, padding: 12, backgroundColor: '#fff', marginBottom: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  shipNo: { fontSize: 15, fontWeight: '700', color: '#0f172a', fontFamily: 'monospace' },
  statusChip: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  chipReady: { backgroundColor: '#f3e8ff' },
  chipDoor: { backgroundColor: '#fef3c7' },
  statusChipText: { fontSize: 10, fontWeight: '700' },
  meta: { fontSize: 12, color: '#64748b' },
  customer: { fontSize: 13, color: '#334155', marginTop: 2 },
  customerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  customerFlex: { flex: 1, marginTop: 0 },
  waitText: { fontSize: 12, color: '#b45309', fontWeight: '600', flexShrink: 0 },
  contentsBtn: { borderRadius: 8, marginTop: 8, backgroundColor: '#f8fafc' },
  contentsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  contentsText: { flex: 1, fontSize: 12, color: '#4338ca', fontWeight: '600' },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actBtn: { flex: 1 },
  emptySub: { fontSize: 13, color: '#94a3b8', marginTop: 24, textAlign: 'center' },
  sheet: { borderRadius: 16, padding: 16, backgroundColor: '#fff', alignSelf: 'stretch' },
  sheetTitle: { fontWeight: '700', marginBottom: 4, color: '#0f172a' },
  unreadyHint: { fontSize: 13, color: '#64748b', marginTop: 8, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1 },
});

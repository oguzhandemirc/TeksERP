import React, { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import {
  Surface,
  Text,
  Button,
  TextInput,
  ActivityIndicator,
  TouchableRipple,
  Divider,
  Appbar,
  Icon,
} from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import dayjs from 'dayjs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ScreenChrome from '../../../components/ScreenChrome';
import RefreshButton from '../../../components/RefreshButton';
import { packingService, type SackStoreShipment } from '../../../services/packing.service';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import { useShipmentConfirmationEnabled, FLAGS_KEY } from '../../../hooks/useFeatureFlags';
import type { MainStackParamList } from '../../../navigation/types';

// =============================================================================
// Çuval Depo & Çıkış — çuvallanmış bekleyen mal. İki evre:
//   • Çuval Depo (READY): firma içi depoda, ileri tarih (ihracat aylarca) bekler.
//   • Kapı Önü (AT_DOOR): kamyon bekliyor; "Alındı" onayıyla çıkar.
// Sevk onayı bayrağı AÇIK → çıkış yalnız kapı önünden ("Alındı"). KAPALI → çuval
// depodan direkt "Sevk Et". Stok yalnız çıkışta (DISPATCH) düşer.
// =============================================================================

const fmtM = (m: number) => m.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
const fmtKg = (kg: number | null) => (kg != null ? `${kg.toLocaleString('tr-TR')} kg` : '— kg');

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

  const [dispatchShip, setDispatchShip] = useState<SackStoreShipment | null>(null);
  const [unreadyShip, setUnreadyShip] = useState<SackStoreShipment | null>(null);
  const [plate, setPlate] = useState('');
  const [driver, setDriver] = useState('');
  const [carrier, setCarrier] = useState('');

  const storeQuery = useQuery({
    queryKey: ['sack-store'],
    queryFn: () => packingService.listSackStore(),
    staleTime: 10_000,
  });
  const store = storeQuery.data?.data ?? [];
  const ready = useMemo(() => store.filter((s) => s.status === 'READY'), [store]);
  const atDoor = useMemo(() => store.filter((s) => s.status === 'AT_DOOR'), [store]);

  const dispatchedQuery = useQuery({
    queryKey: ['shipments', 'DISPATCHED'],
    queryFn: () => packingService.listShipments({ status: 'DISPATCHED' }),
    staleTime: 30_000,
  });
  const dispatched = dispatchedQuery.data?.data ?? [];

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['sack-store'] });
    void qc.invalidateQueries({ queryKey: ['shipments'] });
  };
  const headerRefresh = useManualRefresh(
    [
      () => qc.invalidateQueries({ queryKey: FLAGS_KEY }), // sevk onayı bayrağını da tazele
      () => storeQuery.refetch(),
      () => dispatchedQuery.refetch(),
    ],
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

  const openDispatch = (sh: SackStoreShipment) => {
    setDispatchShip(sh);
    setPlate('');
    setDriver('');
    setCarrier('');
  };

  const busy = dispatchMut.isPending || moveToDoorMut.isPending || pullBackMut.isPending;
  const loading = storeQuery.isLoading;

  // Tek sevk kartı (çuval içerikleriyle) — durum bazlı aksiyonlar altta.
  const renderCard = (sh: SackStoreShipment, actions: React.ReactNode) => {
    const wait = waitText(sh.readyAt);
    return (
      <Surface key={sh.id} style={styles.card} elevation={1}>
        <View style={styles.cardHead}>
          <Text style={styles.shipNo}>{sh.shipmentNo}</Text>
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

        {/* Çuvallar — kod · kg · içerik (kumaş·renk·metraj) */}
        <View style={styles.sackList}>
          {sh.sacks.map((sk) => (
            <View key={sk.id} style={styles.sackRow}>
              <View style={styles.sackChip}>
                <Icon source="sack" size={13} color="#4338ca" />
                <Text style={styles.sackChipText}>{sk.manualCode?.trim() || `#${sk.seq}`}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sackContents} numberOfLines={2}>
                  {sk.contents.length === 0
                    ? sk.swatchCount > 0
                      ? `${sk.swatchCount} kartela`
                      : 'boş'
                    : sk.contents
                        .map(
                          (c) =>
                            `${c.itemName}${c.colorName ? ` ${c.colorName}` : ''}${
                              c.width ? ` ${c.width}cm` : ''
                            } · ${fmtM(c.qty)}m`,
                        )
                        .join('  ·  ')}
                </Text>
              </View>
              <Text style={styles.sackKg}>{fmtKg(sk.weightKg)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.cardActions}>{actions}</View>
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
      <ScrollView contentContainerStyle={styles.root}>
        {loading && <ActivityIndicator style={{ marginTop: 24 }} />}

        {/* ── KAPI ÖNÜ (AT_DOOR) — kamyon bekliyor, "Alındı" ── */}
        {atDoor.length > 0 && (
          <>
            <Text variant="titleMedium" style={[styles.heading, { color: '#7c3aed' }]}>
              Kapı Önü ({atDoor.length})
            </Text>
            {atDoor.map((sh) =>
              renderCard(
                sh,
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
                </>,
              ),
            )}
          </>
        )}

        {/* ── ÇUVAL DEPO (READY) — firma içi bekliyor ── */}
        <Text variant="titleMedium" style={styles.heading}>
          Çuval Depo ({ready.length})
        </Text>
        {!loading && ready.length === 0 && atDoor.length === 0 ? (
          <Text style={styles.emptySub}>
            Bekleyen çuval yok. Paketleme'de "Çuval Depoya" ile buraya kaldırın.
          </Text>
        ) : (
          ready.map((sh) =>
            renderCard(
              sh,
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
                  // Onay açık: çıkış yalnız kapı önünden → "Kapı Önüne Koy".
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
                  // Onay kapalı: çuval depodan direkt sevk.
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
              </>,
            )
          )
        )}

        {/* ── SEVK EDİLENLER (geçmiş) ── */}
        {dispatched.length > 0 && (
          <>
            <Divider style={{ marginVertical: 16 }} />
            <Text variant="titleMedium" style={styles.heading}>
              Sevk Edilenler ({dispatched.length})
            </Text>
            {dispatched.slice(0, 20).map((sh) => (
              <TouchableRipple
                key={sh.id}
                onPress={() => nav.navigate('SevkiyatDetay', { shipmentId: sh.id, shipmentNo: sh.shipmentNo })}
                style={styles.cardDimWrap}
              >
                <Surface style={styles.cardDim} elevation={0}>
                  <View style={styles.cardHead}>
                    <Text style={styles.shipNo}>{sh.shipmentNo}</Text>
                    <Text style={styles.meta}>{sh._count.sacks} çuval ›</Text>
                  </View>
                  <Text style={styles.customer}>
                    {sh.customer.name}
                    {sh.branch ? ` · ${sh.branch.name}` : ''}
                    {sh.plateNumber ? ` · ${sh.plateNumber}` : ''}
                  </Text>
                </Surface>
              </TouchableRipple>
            ))}
          </>
        )}
      </ScrollView>

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
  root: { padding: 12, paddingBottom: 24 },
  heading: { fontWeight: '700', color: '#0f172a', marginTop: 8, marginBottom: 8 },
  card: { borderRadius: 12, padding: 12, backgroundColor: '#fff', marginBottom: 10 },
  cardDimWrap: { borderRadius: 12, marginBottom: 8 },
  cardDim: { borderRadius: 12, padding: 12, backgroundColor: '#f8fafc' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shipNo: { fontSize: 15, fontWeight: '700', color: '#0f172a', fontFamily: 'monospace' },
  meta: { fontSize: 12, color: '#64748b' },
  customer: { fontSize: 13, color: '#334155', marginTop: 2 },
  customerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  customerFlex: { flex: 1, marginTop: 0 },
  waitText: { fontSize: 12, color: '#b45309', fontWeight: '600', flexShrink: 0 },
  sackList: { marginTop: 8, gap: 4 },
  sackRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sackChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#eef2ff',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 54,
  },
  sackChipText: { fontSize: 11, fontWeight: '700', color: '#4338ca', fontFamily: 'monospace' },
  sackContents: { fontSize: 12, color: '#475569' },
  sackKg: { fontSize: 12, fontWeight: '600', color: '#0f172a', flexShrink: 0 },
  emptySub: { fontSize: 13, color: '#94a3b8', marginBottom: 8 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actBtn: { flex: 1 },
  unreadyHint: { fontSize: 13, color: '#64748b', marginTop: 8, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1 },
  sheet: { borderRadius: 16, padding: 16, backgroundColor: '#fff', alignSelf: 'stretch' },
  sheetTitle: { fontWeight: '700', marginBottom: 4, color: '#0f172a' },
});

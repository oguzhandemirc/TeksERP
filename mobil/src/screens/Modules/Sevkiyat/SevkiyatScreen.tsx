import React, { useState } from 'react';
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
} from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import dayjs from 'dayjs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ScreenChrome from '../../../components/ScreenChrome';
import { packingService, type ShipmentListItem } from '../../../services/packing.service';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import type { MainStackParamList } from '../../../navigation/types';

// =============================================================================
// Sevk Çıkışı — telefon dikey. Bekleyen (READY) sevkler ara depoda/kapıda bekler;
// burada "Çıkış Ver / Ambar Aldı" ile sevk kapanır (stok o an düşer). "Sevke Hazır"
// ① Sevkiyat ekranında yapıldı. Onay açıkken çıkışın tek yeri burasıdır.
// =============================================================================

// Ne kadar süredir bekliyor (readyAt'tan beri) — ara depo bekleme görünürlüğü.
function waitText(readyAt: string | null): string | null {
  if (!readyAt) return null;
  const mins = dayjs().diff(dayjs(readyAt), 'minute');
  if (mins < 60) return 'az önce hazırlandı';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} saattir bekliyor`;
  return `${Math.floor(hours / 24)} gündür bekliyor`;
}

export default function SevkiyatScreen() {
  usePortraitLock(useDeviceType() === 'phone');
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const qc = useQueryClient();
  const [dispatchShip, setDispatchShip] = useState<ShipmentListItem | null>(null);
  const [plate, setPlate] = useState('');
  const [driver, setDriver] = useState('');
  const [carrier, setCarrier] = useState('');

  const readyQuery = useQuery({
    queryKey: ['shipments', 'READY'],
    queryFn: () => packingService.listShipments({ status: 'READY' }),
    staleTime: 10_000,
  });
  const ready = readyQuery.data?.data ?? [];

  const dispatchedQuery = useQuery({
    queryKey: ['shipments', 'DISPATCHED'],
    queryFn: () => packingService.listShipments({ status: 'DISPATCHED' }),
    staleTime: 30_000,
  });
  const dispatched = dispatchedQuery.data?.data ?? [];

  const refresh = () => void qc.invalidateQueries({ queryKey: ['shipments'] });
  const handleRefresh = async () => {
    await qc.invalidateQueries({ queryKey: ['shipments'] });
    Toast.show({ type: 'success', text1: 'Liste güncellendi' });
  };

  const dispatchMut = useMutation({
    mutationFn: (id: string) =>
      packingService.dispatch(id, {
        plateNumber: plate.trim() || null,
        driverName: driver.trim() || null,
        carrier: carrier.trim() || null,
      }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Çıkış verildi — stok düştü' });
      setDispatchShip(null);
      setPlate('');
      setDriver('');
      setCarrier('');
      refresh();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Sevk edilemedi', text2: e.message }),
  });

  const loading = readyQuery.isLoading;
  const refreshing = readyQuery.isFetching || dispatchedQuery.isFetching;

  return (
    <ScreenChrome
      title="Sevk Çıkışı"
      headerExtras={
        <>
          <Appbar.Action
            icon={refreshing ? () => <ActivityIndicator size={18} color="#fff" /> : 'refresh'}
            color="#fff"
            disabled={refreshing}
            onPress={handleRefresh}
            accessibilityLabel="Yenile"
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

        <Text variant="titleMedium" style={styles.heading}>
          Bekleyen Sevkler ({ready.length})
        </Text>
        {!loading && ready.length === 0 ? (
          <Text style={styles.emptySub}>Bekleyen sevk yok. Sevkiyat ekranında "Sevke Hazır" yapın.</Text>
        ) : (
          ready.map((sh) => {
            const wait = waitText(sh.readyAt);
            return (
              <Surface key={sh.id} style={styles.card} elevation={1}>
                <View style={styles.cardHead}>
                  <Text style={styles.sackNo}>{sh.shipmentNo}</Text>
                  <Text style={styles.meta}>
                    {sh._count.rolls} top · {sh._count.sacks} çuval
                  </Text>
                </View>
                <Text style={styles.customer}>
                  {sh.customer.name}
                  {sh.branch ? ` · ${sh.branch.name}` : ''}
                </Text>
                {wait ? <Text style={styles.waitText}>⏳ {wait}</Text> : null}
                <Button
                  mode="contained"
                  icon="truck-check"
                  buttonColor="#1e40af"
                  onPress={() => {
                    setDispatchShip(sh);
                    setPlate(sh.plateNumber ?? '');
                    setDriver(sh.driverName ?? '');
                    setCarrier(sh.carrier ?? '');
                  }}
                  style={{ marginTop: 8 }}
                >
                  Çıkış Ver
                </Button>
              </Surface>
            );
          })
        )}

        {dispatched.length > 0 && (
          <>
            <Divider style={{ marginVertical: 16 }} />
            <Text variant="titleMedium" style={styles.heading}>
              Sevk Edilenler ({dispatched.length})
            </Text>
            {dispatched.slice(0, 20).map((sh) => (
              <TouchableRipple
                key={sh.id}
                onPress={() =>
                  nav.navigate('SevkiyatDetay', { shipmentId: sh.id, shipmentNo: sh.shipmentNo })
                }
                style={styles.cardDimWrap}
              >
                <Surface style={styles.cardDim} elevation={0}>
                  <View style={styles.cardHead}>
                    <Text style={styles.sackNo}>{sh.shipmentNo}</Text>
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

      <AppModal visible={dispatchShip !== null} onDismiss={() => setDispatchShip(null)}>
        <Surface style={styles.sheet} elevation={4}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            {dispatchShip?.shipmentNo} — Çıkış Ver
          </Text>
          <Text style={styles.customer}>
            {dispatchShip?.customer.name} · {dispatchShip?._count.sacks} çuval · {dispatchShip?._count.rolls} top
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
              buttonColor="#1e40af"
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
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { padding: 12, paddingBottom: 24 },
  heading: { fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  card: { borderRadius: 12, padding: 12, backgroundColor: '#fff', marginBottom: 10 },
  cardDimWrap: { borderRadius: 12, marginBottom: 8 },
  cardDim: { borderRadius: 12, padding: 12, backgroundColor: '#f8fafc' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sackNo: { fontSize: 15, fontWeight: '700', color: '#0f172a', fontFamily: 'monospace' },
  meta: { fontSize: 12, color: '#64748b' },
  customer: { fontSize: 13, color: '#334155', marginTop: 2 },
  waitText: { fontSize: 12, color: '#b45309', marginTop: 4, fontWeight: '600' },
  emptySub: { fontSize: 13, color: '#94a3b8', marginBottom: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1 },
  sheet: { borderRadius: 16, padding: 16, backgroundColor: '#fff', alignSelf: 'stretch' },
  sheetTitle: { fontWeight: '700', marginBottom: 4, color: '#0f172a' },
});

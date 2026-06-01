import React, { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import {
  Surface,
  Text,
  Button,
  TextInput,
  ActivityIndicator,
  Divider,
} from 'react-native-paper';
import RNModal from 'react-native-modal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import ScreenChrome from '../../../components/ScreenChrome';
import { packingService, type ShipmentListItem } from '../../../services/packing.service';
import { usePortraitLock } from '../../../hooks/usePortraitLock';

// =============================================================================
// Sevkiyat — telefon dikey. Kapıdaki (READY) sevkiyatlar → plaka/şoför → kamyon.
// "Sevke Hazır" tartı/paket ekranında yapıldı; burada irsaliye + sevk kapanır.
// =============================================================================

export default function SevkiyatScreen() {
  usePortraitLock();
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

  const dispatchMut = useMutation({
    mutationFn: (id: string) =>
      packingService.dispatch(id, {
        plateNumber: plate.trim() || null,
        driverName: driver.trim() || null,
        carrier: carrier.trim() || null,
      }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Sevk edildi (kamyona yüklendi)' });
      setDispatchShip(null);
      setPlate('');
      setDriver('');
      setCarrier('');
      refresh();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Sevk edilemedi', text2: e.message }),
  });

  const loading = readyQuery.isLoading;

  return (
    <ScreenChrome title="Sevkiyat" subtitle="Kapıdaki sevkiyatlar → kamyon">
      <ScrollView contentContainerStyle={styles.root}>
        {loading && <ActivityIndicator style={{ marginTop: 24 }} />}

        <Text variant="titleMedium" style={styles.heading}>
          Kapıda Bekleyen ({ready.length})
        </Text>
        {!loading && ready.length === 0 ? (
          <Text style={styles.emptySub}>Kapıda bekleyen sevkiyat yok. Tartı/Paket'te "Sevke Hazır" yapın.</Text>
        ) : (
          ready.map((sh) => (
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
              <Button
                mode="contained"
                icon="truck"
                buttonColor="#1e40af"
                onPress={() => {
                  setDispatchShip(sh);
                  setPlate(sh.plateNumber ?? '');
                  setDriver(sh.driverName ?? '');
                  setCarrier(sh.carrier ?? '');
                }}
                style={{ marginTop: 8 }}
              >
                Sevk Et
              </Button>
            </Surface>
          ))
        )}

        {dispatched.length > 0 && (
          <>
            <Divider style={{ marginVertical: 16 }} />
            <Text variant="titleMedium" style={styles.heading}>
              Sevk Edilenler ({dispatched.length})
            </Text>
            {dispatched.slice(0, 20).map((sh) => (
              <Surface key={sh.id} style={styles.cardDim} elevation={0}>
                <View style={styles.cardHead}>
                  <Text style={styles.sackNo}>{sh.shipmentNo}</Text>
                  <Text style={styles.meta}>{sh._count.sacks} çuval</Text>
                </View>
                <Text style={styles.customer}>
                  {sh.customer.name}
                  {sh.branch ? ` · ${sh.branch.name}` : ''}
                  {sh.plateNumber ? ` · ${sh.plateNumber}` : ''}
                </Text>
              </Surface>
            ))}
          </>
        )}
      </ScrollView>

      <RNModal isVisible={dispatchShip !== null} onBackdropPress={() => setDispatchShip(null)} style={styles.modal}>
        <Surface style={styles.sheet} elevation={4}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            {dispatchShip?.shipmentNo} — Sevk Et
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
              icon="truck"
              buttonColor="#1e40af"
              style={styles.actionBtn}
              loading={dispatchMut.isPending}
              disabled={dispatchMut.isPending}
              onPress={() => {
                if (dispatchShip) dispatchMut.mutate(dispatchShip.id);
              }}
            >
              Kamyona Yükle
            </Button>
          </View>
        </Surface>
      </RNModal>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { padding: 12, paddingBottom: 24 },
  heading: { fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  card: { borderRadius: 12, padding: 12, backgroundColor: '#fff', marginBottom: 10 },
  cardDim: { borderRadius: 12, padding: 12, backgroundColor: '#f8fafc', marginBottom: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sackNo: { fontSize: 15, fontWeight: '700', color: '#0f172a', fontFamily: 'monospace' },
  meta: { fontSize: 12, color: '#64748b' },
  customer: { fontSize: 13, color: '#334155', marginTop: 2 },
  emptySub: { fontSize: 13, color: '#94a3b8', marginBottom: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1 },
  modal: { justifyContent: 'center', margin: 16 },
  sheet: { borderRadius: 16, padding: 16, backgroundColor: '#fff' },
  sheetTitle: { fontWeight: '700', marginBottom: 4, color: '#0f172a' },
});

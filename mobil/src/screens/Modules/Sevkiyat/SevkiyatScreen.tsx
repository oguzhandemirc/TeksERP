import React, { useMemo, useState } from 'react';
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
import {
  packingService,
  shipmentService,
  type SackListItem,
  type ShipmentListItem,
} from '../../../services/packing.service';
import { usePortraitLock } from '../../../hooks/usePortraitLock';

// =============================================================================
// Sevkiyat — telefon dikey. Omurga: KAPALI çuvallar → irsaliye → kamyon.
//   Sevk bekleyen (müşteriye göre) → İrsaliye Oluştur → Plaka/Şoför → Sevk Et.
// =============================================================================

interface CustomerGroup {
  customer: SackListItem['customer'];
  sacks: SackListItem[];
}

export default function SevkiyatScreen() {
  usePortraitLock(); // telefon dikey
  const qc = useQueryClient();
  const [dispatchShip, setDispatchShip] = useState<ShipmentListItem | null>(null);
  const [plate, setPlate] = useState('');
  const [driver, setDriver] = useState('');

  const closedQuery = useQuery({
    queryKey: ['sacks', 'CLOSED', 'unassigned'],
    queryFn: () => packingService.listSacks({ status: 'CLOSED', unassignedOnly: true }),
    staleTime: 10_000,
  });
  const closedSacks = closedQuery.data?.data ?? [];

  const shipmentsQuery = useQuery({
    queryKey: ['shipments', 'PREPARING'],
    queryFn: () => shipmentService.list({ status: 'PREPARING' }),
    staleTime: 10_000,
  });
  const shipments = shipmentsQuery.data?.data ?? [];

  const groups: CustomerGroup[] = useMemo(() => {
    const m = new Map<string, CustomerGroup>();
    for (const s of closedSacks) {
      const g = m.get(s.customer.id) ?? { customer: s.customer, sacks: [] };
      g.sacks.push(s);
      m.set(s.customer.id, g);
    }
    return [...m.values()];
  }, [closedSacks]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['sacks'] });
    void qc.invalidateQueries({ queryKey: ['shipments'] });
  };

  const createShipmentMut = useMutation({
    mutationFn: async (group: CustomerGroup) => {
      const res = await shipmentService.create({ customerId: group.customer.id });
      const shipmentId = res.data?.id;
      if (!shipmentId) throw new Error('İrsaliye oluşturulamadı');
      for (const s of group.sacks) {
        await shipmentService.addSack(shipmentId, s.id);
      }
      return res.data;
    },
    onSuccess: (data) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'İrsaliye oluşturuldu', text2: data?.shipmentNo });
      refresh();
    },
    onError: (e: Error) =>
      Toast.show({ type: 'error', text1: 'İrsaliye oluşturulamadı', text2: e.message }),
  });

  const dispatchMut = useMutation({
    mutationFn: ({ id, plateNumber, driverName }: { id: string; plateNumber: string; driverName: string }) =>
      shipmentService.dispatch(id, {
        plateNumber: plateNumber.trim() || null,
        driverName: driverName.trim() || null,
      }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'İrsaliye sevk edildi' });
      setDispatchShip(null);
      setPlate('');
      setDriver('');
      refresh();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Sevk edilemedi', text2: e.message }),
  });

  const loading = closedQuery.isLoading || shipmentsQuery.isLoading;

  return (
    <ScreenChrome title="Sevkiyat" subtitle="İrsaliye & kamyon">
      <ScrollView contentContainerStyle={styles.root}>
        {loading && <ActivityIndicator style={{ marginTop: 24 }} />}

        {/* SEVK BEKLEYEN — kapalı çuvallar müşteriye göre */}
        <Text variant="titleMedium" style={styles.heading}>
          Sevk Bekleyen ({groups.length} müşteri)
        </Text>
        {!loading && groups.length === 0 ? (
          <Text style={styles.emptySub}>Sevk bekleyen kapalı çuval yok.</Text>
        ) : (
          groups.map((g) => {
            const kg = g.sacks.reduce((sum, x) => sum + (x.weightKg ?? 0), 0);
            return (
              <Surface key={g.customer.id} style={styles.card} elevation={1}>
                <View style={styles.cardHead}>
                  <Text style={styles.title}>{g.customer.name}</Text>
                  <Text style={styles.meta}>
                    {g.sacks.length} çuval · {kg.toLocaleString('tr-TR')} kg
                  </Text>
                </View>
                <Button
                  mode="contained"
                  icon="file-document-outline"
                  onPress={() => createShipmentMut.mutate(g)}
                  loading={createShipmentMut.isPending}
                  disabled={createShipmentMut.isPending}
                  style={{ marginTop: 8 }}
                >
                  İrsaliye Oluştur
                </Button>
              </Surface>
            );
          })
        )}

        <Divider style={{ marginVertical: 16 }} />

        {/* HAZIRLANAN İRSALİYELER */}
        <Text variant="titleMedium" style={styles.heading}>
          Hazırlanan İrsaliyeler ({shipments.length})
        </Text>
        {!loading && shipments.length === 0 ? (
          <Text style={styles.emptySub}>Hazırlanan irsaliye yok.</Text>
        ) : (
          shipments.map((sh) => (
            <Surface key={sh.id} style={styles.card} elevation={1}>
              <View style={styles.cardHead}>
                <Text style={styles.sackNo}>{sh.shipmentNo}</Text>
                <Text style={styles.meta}>{sh._count.sacks} çuval</Text>
              </View>
              <Text style={styles.customer}>
                {sh.customer.name}
                {sh.branch ? ` · ${sh.branch.name}` : ''}
              </Text>
              {sh.plateNumber ? <Text style={styles.meta}>Plaka: {sh.plateNumber}</Text> : null}
              <Button
                mode="contained"
                icon="truck"
                buttonColor="#1e40af"
                onPress={() => {
                  setDispatchShip(sh);
                  setPlate(sh.plateNumber ?? '');
                  setDriver(sh.driverName ?? '');
                }}
                disabled={sh._count.sacks === 0}
                style={{ marginTop: 8 }}
              >
                Sevk Et
              </Button>
            </Surface>
          ))
        )}
      </ScrollView>

      {/* Sevk et — plaka/şoför */}
      <RNModal
        isVisible={dispatchShip !== null}
        onBackdropPress={() => setDispatchShip(null)}
        style={styles.modal}
      >
        <Surface style={styles.sheet} elevation={4}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            {dispatchShip?.shipmentNo} — Sevk Et
          </Text>
          <Text style={styles.customer}>
            {dispatchShip?.customer.name} · {dispatchShip?._count.sacks} çuval
          </Text>
          <TextInput
            mode="outlined"
            label="Plaka"
            value={plate}
            onChangeText={setPlate}
            autoCapitalize="characters"
            style={{ marginTop: 12 }}
          />
          <TextInput
            mode="outlined"
            label="Şoför"
            value={driver}
            onChangeText={setDriver}
            style={{ marginTop: 8 }}
          />
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
                if (!dispatchShip) return;
                dispatchMut.mutate({ id: dispatchShip.id, plateNumber: plate, driverName: driver });
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
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
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

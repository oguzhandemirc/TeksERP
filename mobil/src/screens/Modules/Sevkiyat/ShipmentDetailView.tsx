import React, { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, ActivityIndicator, Chip, Button, Surface } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import * as Print from 'expo-print';
import Toast from 'react-native-toast-message';
import dayjs from 'dayjs';
import {
  packingService,
  SHIPMENT_STATUS_TR,
  type ShipmentStatus,
} from '../../../services/packing.service';
import { buildDispatchNoteHtml } from './dispatchNoteHtml';

const n = (v: number): string => Math.round(Number(v) || 0).toLocaleString('tr-TR');

const STATUS_COLOR: Record<ShipmentStatus, string> = {
  PREPARING: '#d97706',
  READY: '#0284c7',
  DISPATCHED: '#16a34a',
  CANCELLED: '#94a3b8',
};

// Paylaşılan sevkiyat detayı — SevkiyatDetayScreen (push) içinden kullanılır.
// Lazy: yalnız bu bileşen mount olunca detay çekilir (liste değil).
export default function ShipmentDetailView({ shipmentId }: { shipmentId: string }) {
  const [printing, setPrinting] = useState(false);

  const q = useQuery({
    queryKey: ['shipment', shipmentId],
    queryFn: () => packingService.getShipment(shipmentId),
    staleTime: 10_000,
  });
  const d = q.data?.data ?? null;

  if (q.isLoading || !d) return <ActivityIndicator style={{ marginTop: 24 }} />;

  const printNote = async (): Promise<void> => {
    try {
      setPrinting(true);
      await Print.printAsync({
        html: buildDispatchNoteHtml(d),
        margins: { left: 0, top: 0, right: 0, bottom: 0 },
      });
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (!/did not complete|cancel/i.test(msg)) {
        Toast.show({ type: 'error', text1: 'Yazdırılamadı', text2: msg });
      }
    } finally {
      setPrinting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={styles.headRow}>
        <Text style={styles.bigCustomer}>
          {d.customer.name}
          {d.branch ? ` · ${d.branch.name}` : ''}
        </Text>
        <Chip
          compact
          textStyle={styles.chipText}
          style={[styles.chip, { backgroundColor: STATUS_COLOR[d.status] }]}
        >
          {SHIPMENT_STATUS_TR[d.status]}
        </Chip>
      </View>
      <Text style={styles.meta}>
        {d.dispatchedAt ? dayjs(d.dispatchedAt).format('DD.MM.YYYY HH:mm') : '—'}
        {d.plateNumber ? ` · ${d.plateNumber}` : ''}
        {d.driverName ? ` · ${d.driverName}` : ''}
        {d.carrier ? ` · ${d.carrier}` : ''}
      </Text>
      <Text style={styles.summary}>
        {d.summary.rollCount} top · {d.summary.sackCount} çuval · {n(d.summary.totalMeters)} m ·{' '}
        {n(d.summary.totalKg)} kg
      </Text>

      <Button
        mode="contained"
        icon="file-document-outline"
        onPress={printNote}
        loading={printing}
        disabled={printing}
        buttonColor="#1e40af"
        style={{ marginTop: 12 }}
      >
        Sevk İrsaliyesi
      </Button>

      <Text style={styles.section}>Siparişler</Text>
      {d.orders.map((o) => (
        <Surface key={o.id} style={styles.card} elevation={0}>
          <View style={styles.rowBetween}>
            <Text style={styles.rowMono}>{o.orderNumber}</Text>
            <Text style={styles.meta}>
              {n(o.lines.reduce((s, l) => s + l.thisShipment, 0))} m
            </Text>
          </View>
          {o.lines
            .filter((l) => l.thisShipment > 0)
            .map((l) => (
              <View key={l.lineId} style={styles.lineRow}>
                <Text style={styles.lineText} numberOfLines={1}>
                  {l.customerItemName ?? l.item.name}
                  {l.color ? ` · ${l.customerColorName ?? l.color.name}` : ''}
                  {l.width ? ` · ${l.width}cm` : ''}
                </Text>
                <Text style={styles.meta}>{n(l.thisShipment)} m</Text>
              </View>
            ))}
        </Surface>
      ))}

      <Text style={styles.section}>Giden Toplar ({d.rolls.length})</Text>
      {d.rolls.map((r) => (
        <View key={r.id} style={styles.row}>
          <Text style={styles.rowMono}>{r.barcode ?? '—'}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {r.item.name}
            {r.color ? ` · ${r.color.name}` : ''} · {n(r.currentQty)} m
          </Text>
        </View>
      ))}

      <Text style={styles.section}>Çuvallar ({d.sacks.length})</Text>
      {d.sacks.map((s) => (
        <View key={s.id} style={styles.row}>
          <Text style={styles.rowMono}>Çuval {s.seq}</Text>
          <Text style={styles.meta}>{n(s.weightKg ?? 0)} kg</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 12, paddingBottom: 40 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chip: { borderRadius: 6 },
  chipText: { color: '#fff', fontSize: 11 },
  bigCustomer: { flex: 1, fontSize: 17, fontWeight: '700', color: '#0f172a' },
  meta: { fontSize: 12, color: '#64748b' },
  summary: { fontSize: 13, color: '#334155', marginTop: 4 },
  section: { fontSize: 13, fontWeight: '700', color: '#0f172a', marginTop: 16, marginBottom: 6 },
  card: { borderRadius: 10, padding: 10, backgroundColor: '#f8fafc', marginBottom: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  lineText: { flex: 1, fontSize: 12, color: '#334155' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  rowMono: { fontSize: 14, fontWeight: '700', color: '#0f172a', fontFamily: 'monospace' },
});

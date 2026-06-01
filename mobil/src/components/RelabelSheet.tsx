import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import {
  Surface,
  Text,
  Button,
  ActivityIndicator,
  TouchableRipple,
  Divider,
} from 'react-native-paper';
import RNModal from 'react-native-modal';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orderService } from '../services/order.service';
import { packingService } from '../services/packing.service';

// =============================================================================
// Değişebilir Etiket / Yönlendir — topu başka müşterinin siparişine ata, ya da
// stoğa al (etiketi kaldır). Aday = topun spec'ine uyan açık sipariş kalemleri.
// Stok hareketi değil; fiziksel etiket sonradan tambur yazıcısından basılır.
// =============================================================================

export interface RelabelRoll {
  id: string;
  barcode: string | null;
  itemId: string;
  colorId?: string | null;
  width?: number | null;
  itemName?: string;
  colorName?: string | null;
}

interface Props {
  roll: RelabelRoll | null;
  onDismiss: () => void;
  onDone: () => void;
}

export default function RelabelSheet({ roll, onDismiss, onDone }: Props) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['relabel-candidates', roll?.itemId, roll?.colorId ?? null, roll?.width ?? null],
    queryFn: () =>
      orderService.getAvailableOrderLines({
        itemId: roll!.itemId,
        colorId: roll?.colorId ?? undefined,
        width: roll?.width ?? undefined,
      }),
    enabled: roll !== null,
    staleTime: 10_000,
  });
  const candidates = q.data?.data ?? [];

  const relabelMut = useMutation({
    mutationFn: (lineId: string | null) => packingService.relabel(roll!.id, lineId),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const d = res.data;
      Toast.show({
        type: d?.specMismatch ? 'info' : 'success',
        text1: d?.specMismatch ? 'Yönlendirildi (özellik uyumsuz!)' : 'Yönlendirildi',
        text2: d?.reprintRequired
          ? `${d.customerName ?? 'Stok'} — etiketi tambur yazıcısından yeniden bas`
          : d?.customerName ?? undefined,
      });
      // Tambur print-queue badge'i tazelensin
      void qc.invalidateQueries({ queryKey: ['shipping', 'reprint-queue'] });
      onDone();
      onDismiss();
    },
    onError: (e: Error) =>
      Toast.show({ type: 'error', text1: 'Yönlendirilemedi', text2: e.message }),
  });

  return (
    <RNModal isVisible={roll !== null} onBackdropPress={onDismiss} style={styles.modal}>
      <Surface style={styles.sheet} elevation={4}>
        <Text variant="titleMedium" style={styles.title}>
          Yönlendir / Etiketi Değiştir
        </Text>
        <Text style={styles.spec}>
          {roll?.barcode ?? '—'} · {roll?.itemName ?? ''}
          {roll?.colorName ? ` · ${roll.colorName}` : ''}
          {roll?.width ? ` · ${roll.width}cm` : ''}
        </Text>
        <Divider style={{ marginVertical: 8 }} />
        <Text style={styles.label}>Hedef sipariş kalemi seç:</Text>
        {q.isLoading ? (
          <ActivityIndicator style={{ marginVertical: 16 }} />
        ) : candidates.length === 0 ? (
          <Text style={styles.empty}>Uygun açık sipariş yok.</Text>
        ) : (
          <ScrollView style={{ maxHeight: 300 }}>
            {candidates.map((c) => (
              <TouchableRipple
                key={c.lineId}
                onPress={() => relabelMut.mutate(c.lineId)}
                disabled={relabelMut.isPending}
                style={styles.row}
              >
                <View>
                  <Text style={styles.rowCustomer}>{c.customerName}</Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {c.orderNumber} · {c.customerItemName ?? c.itemName}
                    {c.colorName ? ` · ${c.colorName}` : ''}
                    {c.width ? ` · ${c.width}cm` : ''} · açık {Math.round(c.openQty)}m
                  </Text>
                </View>
              </TouchableRipple>
            ))}
          </ScrollView>
        )}
        <Button
          mode="outlined"
          icon="archive-arrow-down"
          onPress={() => relabelMut.mutate(null)}
          disabled={relabelMut.isPending}
          style={{ marginTop: 10 }}
        >
          Stoğa Al (etiketi kaldır)
        </Button>
        <Button onPress={onDismiss} style={{ marginTop: 4 }}>
          İptal
        </Button>
      </Surface>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  modal: { justifyContent: 'center', margin: 16 },
  sheet: { borderRadius: 16, padding: 16, backgroundColor: '#fff' },
  title: { fontWeight: '700', color: '#0f172a' },
  spec: { fontSize: 13, color: '#475569', marginTop: 4 },
  label: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  empty: { fontSize: 13, color: '#94a3b8', marginVertical: 12 },
  row: { paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8 },
  rowCustomer: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  rowMeta: { fontSize: 12, color: '#64748b', marginTop: 2 },
});

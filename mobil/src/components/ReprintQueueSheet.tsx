import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Surface, Text, Button, ActivityIndicator, Divider } from 'react-native-paper';
import RNModal from 'react-native-modal';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { packingService, type ReprintItem } from '../services/packing.service';

// =============================================================================
// Print-queue — relabel sonrası fiziksel etiketi yeniden basılacak toplar.
// Tek yazıcı tamburda olduğu için bu liste Tambur ekranından açılır.
// "Bastım" → topu kuyruktan düşürür (needsReprint=false).
// =============================================================================

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

export default function ReprintQueueSheet({ visible, onDismiss }: Props) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['shipping', 'reprint-queue'],
    queryFn: () => packingService.getReprintQueue(),
    enabled: visible,
    staleTime: 10_000,
  });
  const rows = q.data?.data ?? [];

  const doneMut = useMutation({
    mutationFn: (rollId: string) => packingService.markReprinted(rollId),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void qc.invalidateQueries({ queryKey: ['shipping', 'reprint-queue'] });
    },
    onError: (e: Error) =>
      Toast.show({ type: 'error', text1: 'İşaretlenemedi', text2: e.message }),
  });

  return (
    <RNModal isVisible={visible} onBackdropPress={onDismiss} style={styles.modal}>
      <Surface style={styles.sheet} elevation={4}>
        <Text variant="titleMedium" style={styles.title}>
          Yeniden Basılacak Etiketler{rows.length ? ` (${rows.length})` : ''}
        </Text>
        <Text style={styles.hint}>
          Yönlendirilen toplar — fiziksel etiketi bu yazıcıdan yeniden bas, sonra
          &quot;Bastım&quot;.
        </Text>
        <Divider style={{ marginVertical: 8 }} />
        {q.isLoading ? (
          <ActivityIndicator style={{ marginVertical: 16 }} />
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>Kuyruk boş.</Text>
        ) : (
          <ScrollView style={{ maxHeight: 360 }}>
            {rows.map((r) => (
              <ReprintRow
                key={r.id}
                r={r}
                onDone={() => doneMut.mutate(r.id)}
                busy={doneMut.isPending && doneMut.variables === r.id}
              />
            ))}
          </ScrollView>
        )}
        <Button onPress={onDismiss} style={{ marginTop: 8 }}>
          Kapat
        </Button>
      </Surface>
    </RNModal>
  );
}

function ReprintRow({
  r,
  onDone,
  busy,
}: {
  r: ReprintItem;
  onDone: () => void;
  busy: boolean;
}) {
  const customer = r.targetOrderLine?.order.customer.name ?? 'Stok / etiketsiz';
  const itemName = r.targetOrderLine?.customerItemName ?? r.item.name;
  const colorName = r.targetOrderLine?.customerColorName ?? r.color?.name ?? null;
  return (
    <Surface style={styles.row} elevation={1}>
      <View style={styles.rowInfo}>
        <Text style={styles.rowCustomer}>{customer}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {r.barcode ?? '—'} · {itemName}
          {colorName ? ` · ${colorName}` : ''}
          {r.width ? ` · ${r.width}cm` : ''}
          {r.targetOrderLine ? ` · ${r.targetOrderLine.order.orderNumber}` : ''}
        </Text>
      </View>
      <Button
        mode="contained-tonal"
        icon="printer-check"
        onPress={onDone}
        loading={busy}
        disabled={busy}
        compact
      >
        Bastım
      </Button>
    </Surface>
  );
}

const styles = StyleSheet.create({
  modal: { justifyContent: 'center', margin: 16 },
  sheet: { borderRadius: 16, padding: 16, backgroundColor: '#fff' },
  title: { fontWeight: '700', color: '#0f172a' },
  hint: { fontSize: 12, color: '#64748b', marginTop: 4 },
  empty: { fontSize: 13, color: '#94a3b8', marginVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  rowInfo: { flex: 1 },
  rowCustomer: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  rowMeta: { fontSize: 12, color: '#64748b', marginTop: 2 },
});

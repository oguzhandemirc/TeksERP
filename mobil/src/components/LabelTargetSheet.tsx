import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import {
  Surface,
  Text,
  Button,
  TextInput,
  ActivityIndicator,
  TouchableRipple,
  IconButton,
  Divider,
} from 'react-native-paper';
import RNModal from 'react-native-modal';
import { useQuery } from '@tanstack/react-query';
import { useFullscreenModalProps } from '../hooks/useFullscreenModalProps';
import { orderService } from '../services/order.service';
import { customerService } from '../services/customer.service';

// =============================================================================
// Etiket Kime? — bir topun etiketi BASKI ANINDA kime basılacak (gevşek model:
// top→sipariş bağı yok). Seçenekler:
//   ① Topun spec'ine uyan açık sipariş kalemi → orderLineId (tam sipariş bağlamı)
//   ② Tüm müşteriler (WO dışı) → customerId (master alias'lar)
//   ③ Müşterisiz → {} (spec-only üretim etiketi)
// Hiçbir DB durumu değişmez — parent context'i LabelPrinter'a verip basar.
// =============================================================================

export interface LabelTargetRoll {
  id: string;
  barcode: string | null;
  itemId: string;
  colorId?: string | null;
  width?: number | null;
  itemName?: string;
  colorName?: string | null;
}

export type LabelTargetContext = { orderLineId?: string | null; customerId?: string | null };

interface Props {
  roll: LabelTargetRoll | null;
  /** Kesimde önceden seçilen sipariş (varsa) — listede vurgulanır. */
  defaultLineId?: string | null;
  onCancel: () => void;
  onConfirm: (ctx: LabelTargetContext) => void;
}

export default function LabelTargetSheet({ roll, defaultLineId, onCancel, onConfirm }: Props) {
  const modalProps = useFullscreenModalProps();
  const { width: winW, height: winH } = useWindowDimensions();
  // Daralt: tablet/yatayda yarı genişlik ama 460px tavanlı, telefon dikte %92.
  const sheetWidth = winH > winW ? winW * 0.92 : Math.min(winW * 0.5, 460);
  const [mode, setMode] = useState<'choose' | 'manual'>('choose');
  const [custSearch, setCustSearch] = useState('');

  const linesQ = useQuery({
    queryKey: ['label-target-lines', roll?.itemId, roll?.colorId ?? null, roll?.width ?? null],
    queryFn: () =>
      orderService.getAvailableOrderLines({
        itemId: roll!.itemId,
        colorId: roll?.colorId ?? undefined,
        width: roll?.width ?? undefined,
      }),
    enabled: roll !== null && mode === 'choose',
    staleTime: 10_000,
  });
  const candidates = linesQ.data?.data ?? [];

  const custQ = useQuery({
    queryKey: ['customers', 'picker'],
    queryFn: () => customerService.getAll({ page: 1, pageSize: 200 }),
    enabled: roll !== null && mode === 'manual',
    staleTime: 60_000,
  });
  const customers = custQ.data?.data ?? [];
  const filteredCustomers = customers.filter((c) => {
    const q = custSearch.trim().toLocaleLowerCase('tr-TR');
    if (!q) return true;
    return (
      c.name.toLocaleLowerCase('tr-TR').includes(q) ||
      (c.code ?? '').toLocaleLowerCase('tr-TR').includes(q)
    );
  });

  const close = () => {
    setMode('choose');
    setCustSearch('');
  };
  const cancel = () => {
    close();
    onCancel();
  };
  const confirm = (ctx: LabelTargetContext) => {
    close();
    onConfirm(ctx);
  };

  return (
    <RNModal isVisible={roll !== null} onBackdropPress={cancel} style={styles.modal} {...modalProps}>
      <Surface style={[styles.sheet, { width: sheetWidth }]} elevation={4}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text variant="titleMedium" style={styles.title}>
              Etiket kime?
            </Text>
            <Text style={styles.spec} numberOfLines={1}>
              {roll?.barcode ?? '—'} · {roll?.itemName ?? ''}
              {roll?.colorName ? ` · ${roll.colorName}` : ''}
              {roll?.width ? ` · ${roll.width}cm` : ''}
            </Text>
          </View>
          <IconButton
            icon="close"
            size={22}
            onPress={cancel}
            accessibilityLabel="Kapat (basma)"
            style={styles.closeBtn}
          />
        </View>
        <Divider style={{ marginVertical: 8 }} />

        {mode === 'choose' ? (
          <>
            <Text style={styles.label}>Sipariş seç (topun spec'ine uyan açık satırlar):</Text>
            {linesQ.isLoading ? (
              <ActivityIndicator style={{ marginVertical: 16 }} />
            ) : candidates.length === 0 ? (
              <Text style={styles.empty}>Uygun açık sipariş yok — manuel müşteri ya da müşterisiz bas.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 260 }}>
                {candidates.map((c) => {
                  const active = c.lineId === defaultLineId;
                  return (
                    <TouchableRipple
                      key={c.lineId}
                      onPress={() => confirm({ orderLineId: c.lineId })}
                      style={[styles.row, active && styles.rowActive]}
                    >
                      <View>
                        <Text style={styles.rowCustomer}>
                          {c.customerName}
                          {active ? '  ✓ seçili' : ''}
                        </Text>
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {c.orderNumber} · {c.customerItemName ?? c.itemName}
                          {c.colorName ? ` · ${c.colorName}` : ''}
                          {c.width ? ` · ${c.width}cm` : ''} · açık {Math.round(c.openQty)}m
                        </Text>
                      </View>
                    </TouchableRipple>
                  );
                })}
              </ScrollView>
            )}
            <View style={styles.actions}>
              <Button
                mode="contained-tonal"
                icon="account-multiple"
                onPress={() => setMode('manual')}
                style={styles.flexBtn}
              >
                Tüm müşteriler
              </Button>
              <Button
                mode="outlined"
                icon="tag-outline"
                onPress={() => confirm({})}
                style={styles.flexBtn}
              >
                Müşterisiz
              </Button>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.label}>Müşteri seç (tüm müşteriler):</Text>
            <TextInput
              mode="outlined"
              dense
              placeholder="Müşteri ara..."
              value={custSearch}
              onChangeText={setCustSearch}
              left={<TextInput.Icon icon="magnify" />}
              style={{ marginBottom: 8 }}
            />
            {custQ.isLoading ? (
              <ActivityIndicator style={{ marginVertical: 16 }} />
            ) : (
              <ScrollView style={{ maxHeight: 260 }}>
                {filteredCustomers.map((c) => (
                  <TouchableRipple
                    key={c.id}
                    onPress={() => confirm({ customerId: c.id })}
                    style={styles.row}
                  >
                    <View>
                      <Text style={styles.rowCustomer}>{c.name}</Text>
                      {c.code ? <Text style={styles.rowMeta}>{c.code}</Text> : null}
                    </View>
                  </TouchableRipple>
                ))}
                {filteredCustomers.length === 0 && (
                  <Text style={styles.empty}>Müşteri bulunamadı.</Text>
                )}
              </ScrollView>
            )}
            <Button onPress={() => setMode('choose')} style={{ marginTop: 8 }}>
              ← Geri
            </Button>
          </>
        )}
      </Surface>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  modal: { justifyContent: 'center', alignItems: 'center', margin: 16 },
  sheet: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: '#fff',
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  headerText: { flex: 1, paddingTop: 8 },
  closeBtn: { margin: 0, marginRight: -8 },
  title: { fontWeight: '700', color: '#0f172a' },
  spec: { fontSize: 13, color: '#475569', marginTop: 4 },
  label: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  empty: { fontSize: 13, color: '#94a3b8', marginVertical: 12 },
  row: { paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8 },
  rowActive: { backgroundColor: '#ecfdf5' },
  rowCustomer: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  rowMeta: { fontSize: 12, color: '#64748b', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  flexBtn: { flex: 1 },
});

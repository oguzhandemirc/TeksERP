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
import AppModal from './AppModal';
import { useQuery } from '@tanstack/react-query';
import { orderService } from '../services/order.service';
import { customerService } from '../services/customer.service';
import { foldSearchText } from '../utils/searchFold';
import { useTruncationWarning } from '../hooks/useTruncationWarning';

// =============================================================================
// Etiket Kime? — bir topun etiketi BASKI ANINDA kime basılacak (gevşek model:
// top→sipariş bağı yok). Seçenekler:
//   ① Topun spec'ine uyan açık sipariş kalemi → orderLineId (tam sipariş bağlamı)
//   ② Tüm müşteriler (WO dışı) → customerId (master alias'lar)
//   ③ Stok (müşterisiz) → { stock: true } (spec-only üretim etiketi; backend
//      müşteriyi ZORLA null bırakır — eski snapshot/WO tahmini basılmaz)
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
  /** Topun ŞU ANKİ son etiketi — relabel'de "neyi değiştiriyorsun" göstermek için. */
  lastLabelSnapshot?: { customerName: string | null; orderNumber: string | null } | null;
}

// stock: explicit "Stok / müşterisiz" baskı — backend müşteriyi ZORLA null bırakır
// (snapshot'taki eski müşteriyi ve WO tahminini atlar). orderLineId/customerId
// boş + stock yoksa = "doğal etiket" (snapshot/WO çözümü).
export type LabelTargetContext = {
  orderLineId?: string | null;
  customerId?: string | null;
  stock?: boolean;
};

interface Props {
  roll: LabelTargetRoll | null;
  /** Kesimde önceden seçilen sipariş (varsa) — listede vurgulanır. */
  defaultLineId?: string | null;
  /**
   * TOPLU seçim modu (2026-08-09) — N topa AYNI hedef yazılacak.
   *
   * ⚠️ Karışık spec'li (farklı kumaş/renk/en) seçimde SİPARİŞ KALEMİ hedefi
   * ANLAMSIZDIR: kalem tek bir spec'e aittir ve onu farklı spec'li toplara
   * yazmak sessizce yanlış tahsis üretir. Bu durumda liste hiç gösterilmez,
   * yalnız MÜŞTERİ ve STOK seçilebilir.
   *
   * Tek spec'li toplu seçimde kısıt YOKTUR — orada kalem hedefi doğrudur.
   */
  bulkCount?: number;
  /** Seçim karışık spec taşıyor mu — true ise sipariş kalemi seçtirilmez. */
  mixedSpec?: boolean;
  onCancel: () => void;
  onConfirm: (ctx: LabelTargetContext) => void;
}

export default function LabelTargetSheet({
  roll,
  defaultLineId,
  bulkCount,
  mixedSpec,
  onCancel,
  onConfirm,
}: Props) {
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
  useTruncationWarning(custQ.data?.pagination, 'Müşteri');
  const customers = custQ.data?.data ?? [];
  const filteredCustomers = customers.filter((c) => {
    const q = foldSearchText(custSearch);
    if (!q) return true;
    return (
      foldSearchText(c.name).includes(q) ||
      foldSearchText(c.code ?? '').includes(q)
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
    <AppModal visible={roll !== null} onDismiss={cancel}>
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
            {roll?.lastLabelSnapshot?.customerName ? (
              <Text style={styles.currentLabel} numberOfLines={1}>
                Şu an: {roll.lastLabelSnapshot.customerName}
                {roll.lastLabelSnapshot.orderNumber ? ` · ${roll.lastLabelSnapshot.orderNumber}` : ''} — değiştiriyorsun
              </Text>
            ) : null}
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

        {/* TOPLU seçim bilgisi — kaç topa yazılacağı SOMUT söylenir. "N kayıt
            etkilenecek" gibi soyut ifade yeterli değildir kuralının kardeşi. */}
        {bulkCount != null && bulkCount > 1 && (
          <Text style={styles.bulkNote}>
            Seçilen hedef <Text style={{ fontWeight: '800' }}>{bulkCount} topa</Text> yazılacak
            ve etiketleri yeniden basılacak.
            {mixedSpec
              ? ' Seçimde farklı kumaş/renk/en var — sipariş kalemi seçilemez, yalnız müşteri veya stok.'
              : ''}
          </Text>
        )}

        {mode === 'choose' ? (
          <>
            {/* Karışık spec'li toplu seçimde sipariş listesi HİÇ çizilmez —
                gri/pasif göstermek "belki seçilebilir" vaat ederdi. */}
            {mixedSpec ? null : (
            <>
            <Text style={styles.label}>Sipariş seç (topun spec'ine uyan açık satırlar):</Text>
            {linesQ.isLoading ? (
              <ActivityIndicator style={{ marginVertical: 16 }} />
            ) : candidates.length === 0 ? (
              <Text style={styles.empty}>Uygun açık sipariş yok — Tüm müşteriler'den seç ya da Stok bas.</Text>
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
                        {/* Bizdeki ad esas; etikete basılacak müşteri adı etiketli ek. */}
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {c.orderNumber} · {c.itemName}
                          {c.colorName ? ` · ${c.colorName}` : ''}
                          {c.width ? ` · ${c.width}cm` : ''} · açık {Math.round(c.openQty)}m
                          {c.customerItemName ? ` (Müşteride: ${c.customerItemName})` : ''}
                        </Text>
                      </View>
                    </TouchableRipple>
                  );
                })}
              </ScrollView>
            )}
            </>
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
                onPress={() => confirm({ stock: true })}
                style={styles.flexBtn}
              >
                Stok
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
    </AppModal>
  );
}

const styles = StyleSheet.create({
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
  currentLabel: { fontSize: 12, color: '#b45309', marginTop: 4, fontWeight: '600' },
  label: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  empty: { fontSize: 13, color: '#94a3b8', marginVertical: 12 },
  bulkNote: {
    fontSize: 13,
    color: '#7c2d12',
    backgroundColor: '#ffedd5',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  row: { paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8 },
  rowActive: { backgroundColor: '#ecfdf5' },
  rowCustomer: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  rowMeta: { fontSize: 12, color: '#64748b', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  flexBtn: { flex: 1 },
});

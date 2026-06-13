import React, { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, TextInput, List, IconButton, TouchableRipple, Divider } from 'react-native-paper';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import ScreenChrome from '../../../components/ScreenChrome';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import { rollService } from '../../../services/roll.service';
import { customerService } from '../../../services/customer.service';
import { orderService } from '../../../services/order.service';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import type { MainStackParamList } from '../../../navigation/types';

// =============================================================================
// Saha #11 — Hızlı Sipariş. Ham/stok topları arka arkaya okut → müşteri seç →
// sistem topları spec (ürün+renk+en) bazında gruplayıp siparişe çevirir (70 topu
// tek tek satıra girmeden). Toplar siparişe BAĞLANMAZ (gevşek model); STOK
// toplar otomatik sevke hazır (WAREHOUSE) alınır.
// =============================================================================

interface ScannedRoll {
  id: string;
  barcode: string;
  itemName: string;
  colorName: string | null;
  width: number | null;
  qty: number;
}

export default function HizliSiparisScreen() {
  usePortraitLock(useDeviceType() === 'phone');
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();

  const [scanOpen, setScanOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [custSearch, setCustSearch] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [rolls, setRolls] = useState<ScannedRoll[]>([]);

  const lookupMut = useMutation({
    mutationFn: (barcode: string) => rollService.getByBarcode(barcode.trim()),
    onSuccess: (res) => {
      const r = res.data;
      if (!r) return;
      if (rolls.some((x) => x.id === r.id)) {
        Toast.show({ type: 'info', text1: 'Top zaten listede' });
        return;
      }
      if (r.status !== 'STOCK' && r.status !== 'WAREHOUSE') {
        Toast.show({ type: 'error', text1: 'Top uygun değil', text2: `Statü: ${r.status}` });
        return;
      }
      setRolls((prev) => [
        ...prev,
        {
          id: r.id,
          barcode: r.barcode ?? '—',
          itemName: r.item?.name ?? '—',
          colorName: r.color?.name ?? null,
          width: r.width != null ? Number(r.width) : null,
          qty: Number(r.currentQty),
        },
      ]);
      Toast.show({ type: 'success', text1: 'Eklendi', text2: r.barcode ?? '' });
    },
  });

  const custQ = useQuery({
    queryKey: ['customers', 'quick-order', custSearch],
    queryFn: () =>
      customerService.getAll({ page: 1, pageSize: 50, sortBy: 'name', sortOrder: 'asc', search: custSearch || undefined }),
    enabled: custOpen,
  });
  const custOptions: PickerOption[] = (custQ.data?.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
    sublabel: c.code,
  }));

  const submitMut = useMutation({
    mutationFn: () => orderService.quickFromRolls({ customerId: customerId!, rollIds: rolls.map((r) => r.id) }),
    onSuccess: (res) => {
      const d = res.data;
      Toast.show({
        type: 'success',
        text1: `Sipariş açıldı: ${d?.order.orderNumber}`,
        text2: `${d?.lineCount} satır · ${d?.rollCount} top · ${d?.preparedToWarehouse} sevke hazır`,
      });
      setRolls([]);
      setCustomerId(null);
      setCustomerName('');
      nav.goBack();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Sipariş açılamadı', text2: e.message }),
  });

  // Özet: spec bazında grup (önizleme — backend ile aynı mantık).
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; qty: number; count: number }>();
    for (const r of rolls) {
      const key = `${r.itemName}|${r.colorName ?? ''}|${r.width ?? ''}`;
      const label = [r.itemName, r.colorName ?? 'Ham', r.width ? `${r.width}cm` : ''].filter(Boolean).join(' · ');
      const g = map.get(key) ?? { label, qty: 0, count: 0 };
      g.qty += r.qty;
      g.count += 1;
      map.set(key, g);
    }
    return [...map.values()];
  }, [rolls]);

  const totalMeters = rolls.reduce((s, r) => s + r.qty, 0);

  return (
    <ScreenChrome title="Hızlı Sipariş" subtitle="Ham top okut → müşteri seç → sipariş">
      <ScrollView contentContainerStyle={styles.body}>
        <Button mode="contained" icon="barcode-scan" onPress={() => setScanOpen(true)} style={styles.scanBtn}>
          Top Okut ({rolls.length})
        </Button>

        {/* Müşteri seçimi */}
        <TouchableRipple onPress={() => setCustOpen(true)} style={styles.custField} borderless>
          <View>
            <Text variant="labelSmall" style={styles.dim}>Müşteri</Text>
            <Text variant="bodyLarge">{customerName || 'Müşteri seç…'}</Text>
          </View>
        </TouchableRipple>

        {/* Okutulan toplar */}
        {rolls.length > 0 && (
          <>
            <Text variant="titleSmall" style={styles.section}>
              Okutulan Toplar ({rolls.length} top · {totalMeters.toLocaleString('tr-TR')} m)
            </Text>
            {rolls.map((r) => (
              <List.Item
                key={r.id}
                title={r.barcode}
                description={`${r.itemName} · ${r.colorName ?? 'Ham'}${r.width ? ` · ${r.width}cm` : ''} · ${r.qty} m`}
                left={(p) => <List.Icon {...p} icon="package-variant" />}
                right={(p) => (
                  <IconButton
                    {...p}
                    icon="close"
                    onPress={() => setRolls((prev) => prev.filter((x) => x.id !== r.id))}
                  />
                )}
              />
            ))}

            <Divider style={{ marginVertical: 8 }} />
            <Text variant="titleSmall" style={styles.section}>
              Sipariş Satırları (önizleme — {groups.length})
            </Text>
            {groups.map((g, i) => (
              <View key={i} style={styles.groupRow}>
                <Text style={{ flex: 1 }}>{g.label}</Text>
                <Text style={styles.dim}>
                  {g.count} top · {g.qty.toLocaleString('tr-TR')} m
                </Text>
              </View>
            ))}
          </>
        )}

        <Button
          mode="contained"
          icon="check"
          style={styles.submitBtn}
          disabled={!customerId || rolls.length === 0 || submitMut.isPending}
          loading={submitMut.isPending}
          onPress={() => submitMut.mutate()}
        >
          Siparişi Oluştur
        </Button>
      </ScrollView>

      <BarcodeScannerModal
        visible={scanOpen}
        onDismiss={() => setScanOpen(false)}
        onScan={(code) => lookupMut.mutate(code)}
        title="Ham Top Okut"
        continuous
      />

      <PickerModal
        visible={custOpen}
        title="Müşteri Seç"
        options={custOptions}
        selectedValue={customerId}
        loading={custQ.isLoading}
        paginated
        searchValue={custSearch}
        onSearchSubmit={setCustSearch}
        onSelect={(value) => {
          setCustomerId(value);
          setCustomerName(custOptions.find((o) => o.value === value)?.label ?? '');
          setCustOpen(false);
        }}
        onDismiss={() => setCustOpen(false)}
      />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 48 },
  scanBtn: { marginBottom: 12 },
  custField: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#999',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  dim: { opacity: 0.7 },
  section: { marginTop: 8, marginBottom: 4 },
  groupRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  submitBtn: { marginTop: 20 },
});

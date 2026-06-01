import React, { useMemo, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import {
  Surface,
  Text,
  Button,
  TextInput,
  ActivityIndicator,
  TouchableRipple,
  Divider,
  IconButton,
} from 'react-native-paper';
import RNModal from 'react-native-modal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import ScreenChrome from '../../../components/ScreenChrome';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { packingService, type OpenOrder } from '../../../services/packing.service';
import { usePermissions } from '../../../hooks/usePermission';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import type { MainStackParamList } from '../../../navigation/types';

// =============================================================================
// Tartı / Paket — GEVŞEK MODEL, telefon dikey. 3 adım:
//   ① Sipariş seç (tek müşteri+şube, depo karşılaması görünür)
//   ② Topları okut (depodan; canlı karşılama)
//   ③ Çuvalla & tart → Sevke Hazır (karşılanma düşülür, kapıya)
// Aktif PREPARING sevkiyat = paketleme görünümü; yoksa sipariş seçimi.
// =============================================================================

const groupKey = (customerId: string, branchId: string | null) => `${customerId}|${branchId ?? ''}`;

export default function TartiPaketScreen() {
  usePortraitLock();
  const qc = useQueryClient();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { has } = usePermissions();
  const canShip = has('mobile:sevkiyat');

  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [selGroup, setSelGroup] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [sackOpen, setSackOpen] = useState(false);
  const [sackKg, setSackKg] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const scanBusy = useRef(false);

  // ── Queries ──
  const openOrdersQ = useQuery({
    queryKey: ['open-orders'],
    queryFn: () => packingService.listOpenOrders(),
    enabled: shipmentId === null,
    staleTime: 10_000,
  });
  const openOrders = openOrdersQ.data?.data ?? [];

  const preparingQ = useQuery({
    queryKey: ['shipments', 'PREPARING'],
    queryFn: () => packingService.listShipments({ status: 'PREPARING' }),
    enabled: shipmentId === null,
    staleTime: 10_000,
  });
  const preparing = preparingQ.data?.data ?? [];

  const readyQ = useQuery({
    queryKey: ['shipments', 'READY'],
    queryFn: () => packingService.listShipments({ status: 'READY' }),
    enabled: shipmentId === null && canShip,
    staleTime: 10_000,
  });
  const readyCount = readyQ.data?.data?.length ?? 0;

  const shipQ = useQuery({
    queryKey: ['shipment', shipmentId],
    queryFn: () => packingService.getShipment(shipmentId!),
    enabled: shipmentId !== null,
    staleTime: 5_000,
  });
  const ship = shipQ.data?.data ?? null;

  const refreshSelection = () => {
    void qc.invalidateQueries({ queryKey: ['open-orders'] });
    void qc.invalidateQueries({ queryKey: ['shipments'] });
  };
  const refreshShip = () => void qc.invalidateQueries({ queryKey: ['shipment', shipmentId] });

  // ── Mutations ──
  const createMut = useMutation({
    mutationFn: () => packingService.createShipment(selected),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const id = res.data?.id;
      setSelected([]);
      setSelGroup(null);
      if (id) {
        setShipmentId(id);
        setScanOpen(true);
      }
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Sevkiyat açılamadı', text2: e.message }),
  });

  const addSackMut = useMutation({
    mutationFn: (kg: number) => packingService.addSack(shipmentId!, kg),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Çuval eklendi', text2: res.message });
      setSackOpen(false);
      setSackKg('');
      refreshShip();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Çuval eklenemedi', text2: e.message }),
  });

  const removeSackMut = useMutation({
    mutationFn: (sackId: string) => packingService.removeSack(sackId),
    onSuccess: refreshShip,
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Silinemedi', text2: e.message }),
  });

  const removeRollMut = useMutation({
    mutationFn: (rollId: string) => packingService.removeRoll(shipmentId!, rollId),
    onSuccess: refreshShip,
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Çıkarılamadı', text2: e.message }),
  });

  const readyMut = useMutation({
    mutationFn: () => packingService.markReady(shipmentId!),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Sevke hazır — kapıda', text2: res.message });
      setShipmentId(null);
      refreshSelection();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Sevke hazır yapılamadı', text2: e.message }),
  });

  const cancelMut = useMutation({
    mutationFn: () => packingService.cancel(shipmentId!),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Sevkiyat iptal edildi', text2: res.message });
      setCancelOpen(false);
      setShipmentId(null);
      refreshSelection();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'İptal edilemedi', text2: e.message }),
  });

  const cancelPreviewQ = useQuery({
    queryKey: ['shipment', shipmentId, 'cancel-preview'],
    queryFn: () => packingService.cancelPreview(shipmentId!),
    enabled: cancelOpen && shipmentId !== null,
    staleTime: 0,
  });
  const cancelPreview = cancelPreviewQ.data?.data ?? null;

  // ── Okutma ──
  const handleScan = async (barcode: string) => {
    const code = barcode.trim();
    if (!code || !shipmentId || scanBusy.current) return;
    scanBusy.current = true;
    try {
      const res = await packingService.scan(shipmentId, code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: res.data?.kind === 'SWATCH' ? 'Kartela eklendi' : 'Top eklendi', text2: res.message });
      refreshShip();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Eklenemedi', text2: (e as Error).message });
    } finally {
      setTimeout(() => {
        scanBusy.current = false;
      }, 600);
    }
  };

  // ── Sipariş seçimi ──
  const toggleOrder = (o: OpenOrder) => {
    const key = groupKey(o.order.customer.id, o.order.branch?.id ?? null);
    if (selected.includes(o.order.id)) {
      const next = selected.filter((id) => id !== o.order.id);
      setSelected(next);
      if (next.length === 0) setSelGroup(null);
      return;
    }
    if (selected.length > 0 && selGroup !== key) {
      Toast.show({ type: 'info', text1: 'Tek müşteri + şube', text2: 'Önce farklı müşteriyi kaldır.' });
      return;
    }
    setSelGroup(key);
    setSelected((s) => [...s, o.order.id]);
  };

  const sortedOpen = useMemo(
    () =>
      [...openOrders].sort((a, b) => {
        const ad = a.order.deadline ? new Date(a.order.deadline).getTime() : Infinity;
        const bd = b.order.deadline ? new Date(b.order.deadline).getTime() : Infinity;
        return ad - bd;
      }),
    [openOrders],
  );

  // ===========================================================================
  // PAKETLEME GÖRÜNÜMÜ (aktif sevkiyat)
  // ===========================================================================
  if (shipmentId !== null) {
    const rolls = ship?.rolls ?? [];
    const sacks = ship?.sacks ?? [];
    const canReady = (ship?.summary.rollCount ?? 0) + (ship?.summary.swatchCount ?? 0) > 0 && sacks.length > 0;

    return (
      <ScreenChrome title="Paketleme" subtitle={ship?.shipmentNo}>
        <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>
          {shipQ.isLoading || !ship ? (
            <ActivityIndicator style={{ marginTop: 24 }} />
          ) : (
            <>
              <View style={styles.shipHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.customer}>
                    {ship.customer.name}
                    {ship.branch ? ` · ${ship.branch.name}` : ''}
                  </Text>
                  <Text style={styles.summary}>
                    {ship.summary.rollCount} top · {ship.summary.sackCount} çuval ·{' '}
                    {ship.summary.totalKg.toLocaleString('tr-TR')} kg
                  </Text>
                </View>
                <Button compact onPress={() => setShipmentId(null)}>
                  ← Geri
                </Button>
              </View>

              {/* Karşılama — her satır: istenen / okutulan(bu sevkiyat) / kalan */}
              <Text variant="titleSmall" style={styles.section}>
                Karşılama
              </Text>
              {ship.orders.flatMap((o) =>
                o.lines.map((l) => {
                  const remaining = Math.max(0, l.openQty - l.thisShipment);
                  const ok = remaining <= 0;
                  return (
                    <View key={l.lineId} style={styles.covRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.covSpec} numberOfLines={1}>
                          {o.orderNumber} · {l.customerItemName ?? l.item.name}
                          {l.color ? ` · ${l.customerColorName ?? l.color.name}` : ''}
                          {l.width ? ` · ${l.width}cm` : ''}
                        </Text>
                        <Text style={styles.covMeta}>
                          istenen {Math.round(l.openQty)}m · okutulan {Math.round(l.thisShipment)}m
                        </Text>
                      </View>
                      <Text style={[styles.covTag, ok ? styles.covOk : styles.covShort]}>
                        {ok ? '✓' : `${Math.round(remaining)}m eksik`}
                      </Text>
                    </View>
                  );
                }),
              )}

              <Button
                mode="contained"
                icon="barcode-scan"
                onPress={() => setScanOpen(true)}
                style={styles.bigBtn}
                contentStyle={{ height: 52 }}
              >
                Top Okut
              </Button>

              {/* Okutulan toplar */}
              <Text variant="titleSmall" style={styles.section}>
                Okutulan Toplar ({rolls.length})
              </Text>
              {rolls.length === 0 ? (
                <Text style={styles.emptySub}>Henüz top okutulmadı.</Text>
              ) : (
                rolls.map((r) => (
                  <View key={r.id} style={styles.rollRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rollBarcode}>{r.barcode ?? '—'}</Text>
                      <Text style={styles.covMeta}>
                        {r.item.name}
                        {r.color ? ` · ${r.color.name}` : ''} · {Math.round(r.currentQty)}m
                      </Text>
                    </View>
                    <IconButton
                      icon="close-circle-outline"
                      size={20}
                      iconColor="#dc2626"
                      onPress={() => removeRollMut.mutate(r.id)}
                    />
                  </View>
                ))
              )}

              {/* Çuvallar */}
              <View style={styles.section2}>
                <Text variant="titleSmall" style={styles.section}>
                  Çuvallar ({sacks.length})
                </Text>
                <Button compact mode="contained-tonal" icon="plus" onPress={() => setSackOpen(true)}>
                  Çuval Ekle
                </Button>
              </View>
              {sacks.map((s) => (
                <View key={s.id} style={styles.rollRow}>
                  <Text style={styles.rollBarcode}>Çuval {s.seq}</Text>
                  <Text style={styles.covMeta}>{(s.weightKg ?? 0).toLocaleString('tr-TR')} kg</Text>
                  <IconButton
                    icon="close-circle-outline"
                    size={20}
                    iconColor="#dc2626"
                    onPress={() => removeSackMut.mutate(s.id)}
                  />
                </View>
              ))}

              <Divider style={{ marginVertical: 12 }} />
              <Button
                mode="contained"
                icon="truck-check"
                buttonColor="#059669"
                disabled={!canReady || readyMut.isPending}
                loading={readyMut.isPending}
                onPress={() => readyMut.mutate()}
                contentStyle={{ height: 52 }}
              >
                Sevke Hazır
              </Button>
              {!canReady && (
                <Text style={styles.hint}>En az 1 top okut + 1 çuval tart.</Text>
              )}
              <Button textColor="#dc2626" onPress={() => setCancelOpen(true)} style={{ marginTop: 6 }}>
                Sevkiyatı İptal Et
              </Button>
            </>
          )}
        </ScrollView>

        <BarcodeScannerModal
          visible={scanOpen}
          onDismiss={() => setScanOpen(false)}
          onScan={handleScan}
          title="Depodan top okut"
          continuous
        />

        {/* Çuval tartısı */}
        <RNModal isVisible={sackOpen} onBackdropPress={() => setSackOpen(false)} style={styles.modal}>
          <Surface style={styles.sheet} elevation={4}>
            <Text variant="titleMedium" style={styles.sheetTitle}>
              Çuval Ekle — Tartı
            </Text>
            <TextInput
              mode="outlined"
              label="Ağırlık (kg)"
              keyboardType="decimal-pad"
              value={sackKg}
              onChangeText={setSackKg}
              autoFocus
              style={{ marginVertical: 12 }}
              right={
                <TextInput.Icon
                  icon="scale"
                  onPress={() => setSackKg((Math.round((10 + Math.random() * 90) * 10) / 10).toString())}
                />
              }
            />
            <View style={styles.actions}>
              <Button onPress={() => setSackOpen(false)} style={styles.actionBtn}>
                İptal
              </Button>
              <Button
                mode="contained"
                icon="check"
                buttonColor="#059669"
                style={styles.actionBtn}
                loading={addSackMut.isPending}
                disabled={addSackMut.isPending || !(parseFloat(sackKg) > 0)}
                onPress={() => addSackMut.mutate(parseFloat(sackKg))}
              >
                Ekle
              </Button>
            </View>
          </Surface>
        </RNModal>

        {/* İptal onayı — yıkıcı: depoya dönecek toplar + karşılanması geri alınacak siparişler */}
        <RNModal isVisible={cancelOpen} onBackdropPress={() => setCancelOpen(false)} style={styles.modal}>
          <Surface style={styles.sheet} elevation={4}>
            <Text variant="titleMedium" style={styles.sheetTitle}>
              Sevkiyatı İptal Et
            </Text>
            {cancelPreviewQ.isLoading || !cancelPreview ? (
              <ActivityIndicator style={{ marginVertical: 16 }} />
            ) : (
              <>
                <Text style={styles.covMeta}>
                  {cancelPreview.rolls.length} top depoya dönecek
                  {cancelPreview.affectedOrders.length > 0
                    ? ` · ${cancelPreview.affectedOrders.length} siparişin karşılanması geri alınacak`
                    : ''}
                  .
                </Text>
                <ScrollView style={{ maxHeight: 200, marginTop: 8 }}>
                  {cancelPreview.rolls.map((r) => (
                    <Text key={r.id} style={styles.covMeta}>
                      • {r.barcode ?? '—'} · {r.itemName}
                      {r.colorName ? ` · ${r.colorName}` : ''} · {Math.round(r.currentQty)}m
                    </Text>
                  ))}
                  {cancelPreview.affectedOrders.map((o) => (
                    <Text key={o.orderNumber} style={styles.covMeta}>
                      ↩ {o.orderNumber} · −{Math.round(Number(o.qty))}m
                    </Text>
                  ))}
                </ScrollView>
              </>
            )}
            <View style={styles.actions}>
              <Button onPress={() => setCancelOpen(false)} style={styles.actionBtn}>
                Vazgeç
              </Button>
              <Button
                mode="contained"
                icon="close-circle"
                buttonColor="#dc2626"
                style={styles.actionBtn}
                loading={cancelMut.isPending}
                disabled={cancelMut.isPending || cancelPreview?.canCancel === false}
                onPress={() => cancelMut.mutate()}
              >
                İptal Et
              </Button>
            </View>
          </Surface>
        </RNModal>
      </ScreenChrome>
    );
  }

  // ===========================================================================
  // SİPARİŞ SEÇİM GÖRÜNÜMÜ
  // ===========================================================================
  return (
    <ScreenChrome title="Tartı / Paket" subtitle="Sipariş seç → okut → çuvalla">
      <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>
        {canShip && readyCount > 0 && (
          <TouchableRipple onPress={() => nav.navigate('Sevkiyat')} style={styles.bridge}>
            <View style={styles.bridgeInner}>
              <Text style={styles.bridgeText}>{readyCount} sevkiyat kapıda (kamyon bekliyor)</Text>
              <Text style={styles.bridgeCta}>Sevkiyat →</Text>
            </View>
          </TouchableRipple>
        )}

        {/* Devam eden sevkiyatlar */}
        {preparing.length > 0 && (
          <>
            <Text variant="titleSmall" style={styles.section}>
              Devam Eden ({preparing.length})
            </Text>
            {preparing.map((sh) => (
              <TouchableRipple key={sh.id} onPress={() => setShipmentId(sh.id)} style={styles.resumeCard}>
                <View style={styles.bridgeInner}>
                  <View>
                    <Text style={styles.rollBarcode}>{sh.shipmentNo}</Text>
                    <Text style={styles.covMeta}>
                      {sh.customer.name}
                      {sh.branch ? ` · ${sh.branch.name}` : ''} · {sh._count.rolls} top · {sh._count.sacks} çuval
                    </Text>
                  </View>
                  <Text style={styles.bridgeCta}>Sürdür →</Text>
                </View>
              </TouchableRipple>
            ))}
            <Divider style={{ marginVertical: 12 }} />
          </>
        )}

        <Text variant="titleSmall" style={styles.section}>
          Açık Siparişler
        </Text>
        <Text style={styles.hint}>Tek müşteri + şube seç. Depo karşılaması satırda görünür.</Text>

        {openOrdersQ.isLoading ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : sortedOpen.length === 0 ? (
          <Text style={styles.emptySub}>Açık sipariş yok.</Text>
        ) : (
          sortedOpen.map((o) => {
            const isSel = selected.includes(o.order.id);
            const key = groupKey(o.order.customer.id, o.order.branch?.id ?? null);
            const disabled = selected.length > 0 && selGroup !== key && !isSel;
            return (
              <TouchableRipple
                key={o.order.id}
                onPress={() => toggleOrder(o)}
                disabled={disabled}
                style={[styles.orderCard, isSel && styles.orderCardSel, disabled && styles.orderCardDim]}
              >
                <View>
                  <View style={styles.cardHead}>
                    <Text style={styles.rollBarcode}>
                      {isSel ? '✓ ' : ''}
                      {o.order.orderNumber}
                    </Text>
                    <Text style={styles.covMeta}>
                      {o.order.customer.name}
                      {o.order.branch ? ` · ${o.order.branch.name}` : ''}
                    </Text>
                  </View>
                  {o.lines.map((l) => (
                    <View key={l.lineId} style={styles.covRow}>
                      <Text style={styles.covSpec} numberOfLines={1}>
                        {l.customerItemName ?? l.item.name}
                        {l.color ? ` · ${l.color.name}` : ''}
                        {l.width ? ` · ${l.width}cm` : ''} · {Math.round(l.openQty)}m
                      </Text>
                      <Text style={[styles.covTag, l.covered ? styles.covOk : styles.covShort]}>
                        {l.covered
                          ? 'depo ✓'
                          : `${Math.round(Math.max(0, l.openQty - l.warehouseAvailable))}m eksik`}
                      </Text>
                    </View>
                  ))}
                </View>
              </TouchableRipple>
            );
          })
        )}
      </ScrollView>

      {selected.length > 0 && (
        <View style={styles.footer}>
          <Button
            mode="contained"
            icon="arrow-right"
            contentStyle={{ height: 52 }}
            loading={createMut.isPending}
            disabled={createMut.isPending}
            onPress={() => createMut.mutate()}
          >
            Sonraki adım ({selected.length} sipariş)
          </Button>
        </View>
      )}
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { padding: 12, paddingBottom: 32 },
  bridge: { borderRadius: 10, backgroundColor: '#1e40af', marginBottom: 10 },
  bridgeInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  bridgeText: { color: '#fff', fontWeight: '600' },
  bridgeCta: { color: '#bfdbfe', fontWeight: '700' },
  resumeCard: { borderRadius: 10, backgroundColor: '#f1f5f9', marginBottom: 8 },
  section: { fontWeight: '700', color: '#0f172a', marginTop: 8, marginBottom: 4 },
  section2: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  hint: { fontSize: 12, color: '#94a3b8', marginBottom: 6 },
  shipHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  customer: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  summary: { fontSize: 12, color: '#64748b', marginTop: 2 },
  covRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 },
  covSpec: { flex: 1, fontSize: 13, color: '#334155' },
  covMeta: { fontSize: 12, color: '#64748b' },
  covTag: { fontSize: 12, fontWeight: '700' },
  covOk: { color: '#059669' },
  covShort: { color: '#b45309' },
  bigBtn: { borderRadius: 10, marginTop: 12 },
  rollRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
    gap: 8,
  },
  rollBarcode: { fontSize: 14, fontWeight: '700', color: '#0f172a', fontFamily: 'monospace' },
  emptySub: { fontSize: 13, color: '#94a3b8', marginVertical: 8 },
  orderCard: { borderRadius: 12, padding: 12, backgroundColor: '#fff', marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  orderCardSel: { borderColor: '#059669', backgroundColor: '#ecfdf5' },
  orderCardDim: { opacity: 0.45 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  footer: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e2e8f0', backgroundColor: '#fff' },
  modal: { justifyContent: 'center', margin: 16 },
  sheet: { borderRadius: 16, padding: 16, backgroundColor: '#fff' },
  sheetTitle: { fontWeight: '700', marginBottom: 4, color: '#0f172a' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1 },
});

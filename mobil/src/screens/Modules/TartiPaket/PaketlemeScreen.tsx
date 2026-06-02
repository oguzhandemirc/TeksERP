import React, { useRef, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import {
  Surface,
  Text,
  Button,
  TextInput,
  ActivityIndicator,
  IconButton,
  Icon,
  ProgressBar,
  Appbar,
} from 'react-native-paper';
import RNModal from 'react-native-modal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import ScreenChrome from '../../../components/ScreenChrome';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { AnimatedEntrance } from '../../../components/motion';
import { colors, spacing, radius, shadow, typography } from '../../../theme';
import { packingService } from '../../../services/packing.service';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useFullscreenModalProps } from '../../../hooks/useFullscreenModalProps';
import type { MainStackParamList } from '../../../navigation/types';

// =============================================================================
// Paketleme — ayrı sayfa (push). Param: { orderIds } (yeni, geç oluştur) veya
// { shipmentId } (sürdür). İlk top/çuvalda sevkiyat oluşur. Sevke Hazır / İptal
// → geri (sipariş seçimi). Kenardan kaydırma native olarak seçime döner.
// =============================================================================

// Bizdeki ad + (karşıdaki ad) — alias farklıysa parantezde.
const dualName = (ourName: string, custName?: string | null) =>
  custName && custName.trim() && custName !== ourName ? `${ourName} (${custName})` : ourName;

export default function PaketlemeScreen() {
  // Portrait kilidi yalnızca telefonda — tablette zorunlu dik yapma, yatay kalsın.
  usePortraitLock(useDeviceType() === 'phone');
  const modalProps = useFullscreenModalProps();
  const qc = useQueryClient();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, 'Paketleme'>>();
  const params = route.params ?? {};

  const [shipmentId, setShipmentId] = useState<string | null>(params.shipmentId ?? null);
  const [draftOrderIds, setDraftOrderIds] = useState<string[] | null>(params.orderIds ?? null);
  const [scanOpen, setScanOpen] = useState<boolean>(!params.shipmentId && !!params.orderIds);
  const [sackOpen, setSackOpen] = useState(false);
  const [sackKg, setSackKg] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const scanBusy = useRef(false);
  const ensureRef = useRef<Promise<string> | null>(null);

  // Taslak karşılaması için açık siparişler (cache'ten gelir; seçim ekranı doldurmuştur).
  const openOrdersQ = useQuery({
    queryKey: ['open-orders'],
    queryFn: () => packingService.listOpenOrders(),
    enabled: shipmentId === null,
    staleTime: 10_000,
  });
  const openOrders = openOrdersQ.data?.data ?? [];

  const shipQ = useQuery({
    queryKey: ['shipment', shipmentId],
    queryFn: () => packingService.getShipment(shipmentId!),
    enabled: shipmentId !== null,
    staleTime: 5_000,
  });
  const ship = shipQ.data?.data ?? null;

  // id verilmezse state'teki shipmentId — ama ilk aksiyonda (sevkiyat yeni
  // yaratılıyor) state henüz null; o yüzden çağıran ensureShipment'in döndürdüğü
  // gerçek id'yi geçmeli (yoksa ['shipment', null] invalidate edilir → top düşmez).
  const refreshShip = (id: string | null = shipmentId) =>
    void qc.invalidateQueries({ queryKey: ['shipment', id] });
  const finishAndBack = () => {
    void qc.invalidateQueries({ queryKey: ['open-orders'] });
    void qc.invalidateQueries({ queryKey: ['shipments'] });
    nav.goBack();
  };

  // Geç oluştur — ilk top/çuval anında sevkiyatı yarat (eşzamanlı çağrılarda tek kez).
  const ensureShipment = (): Promise<string> => {
    if (shipmentId) return Promise.resolve(shipmentId);
    if (ensureRef.current) return ensureRef.current;
    if (!draftOrderIds) return Promise.reject(new Error('Sipariş seçili değil'));
    const p = packingService
      .createShipment(draftOrderIds)
      .then((res) => {
        const id = res.data?.id;
        if (!id) throw new Error('Sevkiyat açılamadı');
        setShipmentId(id);
        setDraftOrderIds(null);
        // Sipariş artık aktif sevkiyatta → seçim ekranında "Sürdür" görünsün.
        void qc.invalidateQueries({ queryKey: ['shipments'] });
        void qc.invalidateQueries({ queryKey: ['open-orders'] });
        return id;
      })
      .finally(() => {
        ensureRef.current = null;
      });
    ensureRef.current = p;
    return p;
  };

  const addSackMut = useMutation({
    mutationFn: async (kg: number) => {
      const id = await ensureShipment();
      const res = await packingService.addSack(id, kg);
      return { id, message: res.message };
    },
    onSuccess: ({ id, message }) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Çuval eklendi', text2: message });
      setSackOpen(false);
      setSackKg('');
      refreshShip(id);
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Çuval eklenemedi', text2: e.message }),
  });

  const removeSackMut = useMutation({
    mutationFn: (sackId: string) => packingService.removeSack(sackId),
    onSuccess: () => refreshShip(),
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Silinemedi', text2: e.message }),
  });

  const removeRollMut = useMutation({
    mutationFn: (rollId: string) => packingService.removeRoll(shipmentId!, rollId),
    onSuccess: () => refreshShip(),
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Çıkarılamadı', text2: e.message }),
  });

  const readyMut = useMutation({
    mutationFn: () => packingService.markReady(shipmentId!),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Sevke hazır — kapıda', text2: res.message });
      finishAndBack();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Sevke hazır yapılamadı', text2: e.message }),
  });

  const cancelMut = useMutation({
    mutationFn: () => packingService.cancel(shipmentId!),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Sevkiyat iptal edildi', text2: res.message });
      setCancelOpen(false);
      finishAndBack();
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

  const handleScan = async (barcode: string) => {
    const code = barcode.trim();
    if (!code || scanBusy.current) return;
    scanBusy.current = true;
    try {
      const id = await ensureShipment();
      const res = await packingService.scan(id, code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: res.data?.kind === 'SWATCH' ? 'Kartela eklendi' : 'Top eklendi', text2: res.message });
      refreshShip(id);
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Eklenemedi', text2: (e as Error).message });
    } finally {
      setTimeout(() => {
        scanBusy.current = false;
      }, 600);
    }
  };

  const isDraft = shipmentId === null;
  const draftOrders = draftOrderIds ? openOrders.filter((o) => draftOrderIds.includes(o.order.id)) : [];
  const cust = ship?.customer ?? draftOrders[0]?.order.customer ?? null;
  const branch = ship?.branch ?? draftOrders[0]?.order.branch ?? null;
  const rolls = ship?.rolls ?? [];
  const sacks = ship?.sacks ?? [];
  const summary = ship?.summary ?? { rollCount: 0, swatchCount: 0, totalMeters: 0, sackCount: 0, totalKg: 0 };
  const canReady = !isDraft && summary.rollCount + summary.swatchCount > 0 && sacks.length > 0;

  const covRows = ship
    ? ship.orders.flatMap((o) =>
        o.lines.map((l) => ({
          key: l.lineId,
          order: o.orderNumber,
          name: dualName(l.item.name, l.customerItemName),
          colorName: l.color ? dualName(l.color.name, l.customerColorName) : null,
          width: l.width,
          openQty: l.openQty,
          thisShipment: l.thisShipment,
        })),
      )
    : draftOrders.flatMap((o) =>
        o.lines.map((l) => ({
          key: l.lineId,
          order: o.order.orderNumber,
          name: dualName(l.item.name, l.customerItemName),
          colorName: l.color ? dualName(l.color.name, l.customerColorName) : null,
          width: l.width,
          openQty: l.openQty,
          thisShipment: 0,
        })),
      );

  const okCount = covRows.filter((r) => r.openQty - r.thisShipment <= 0).length;
  const covTotal = covRows.length;
  const covProgress = covTotal > 0 ? okCount / covTotal : 0;

  const loadingReal = shipmentId !== null && (shipQ.isLoading || !ship);

  return (
    <ScreenChrome
      title="Paketleme"
      subtitle={ship?.shipmentNo ?? 'Yeni (henüz kaydedilmedi)'}
      onStepBack={() => nav.goBack()}
      headerExtras={
        !isDraft ? (
          <Appbar.Action
            icon="trash-can-outline"
            color={colors.textOnDark}
            onPress={() => setCancelOpen(true)}
            accessibilityLabel="Sevkiyatı iptal et"
          />
        ) : undefined
      }
    >
      {loadingReal ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.loadingText}>Sevkiyat yükleniyor…</Text>
        </View>
      ) : (
        <>
          <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>
            {/* ── Hero: müşteri + KPI + karşılama ilerlemesi ── */}
            <AnimatedEntrance index={0}>
              <Surface style={styles.hero} elevation={0}>
                <View style={styles.heroTop}>
                  <View style={styles.heroIcon}>
                    <Icon source="package-variant-closed" size={22} color={colors.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroCustomer} numberOfLines={1}>
                      {cust?.name ?? '—'}
                    </Text>
                    {branch ? (
                      <Text style={styles.heroBranch} numberOfLines={1}>
                        {branch.name}
                      </Text>
                    ) : null}
                  </View>
                  {isDraft && (
                    <View style={styles.draftChip}>
                      <Text style={styles.draftChipText}>Taslak</Text>
                    </View>
                  )}
                </View>

                <View style={styles.kpiRow}>
                  <View style={styles.kpi}>
                    <Text style={styles.kpiNum}>{summary.rollCount}</Text>
                    <Text style={styles.kpiLabel}>top</Text>
                  </View>
                  <View style={styles.kpiSep} />
                  <View style={styles.kpi}>
                    <Text style={styles.kpiNum}>{summary.sackCount}</Text>
                    <Text style={styles.kpiLabel}>çuval</Text>
                  </View>
                  <View style={styles.kpiSep} />
                  <View style={styles.kpi}>
                    <Text style={styles.kpiNum}>{summary.totalKg.toLocaleString('tr-TR')}</Text>
                    <Text style={styles.kpiLabel}>kg</Text>
                  </View>
                </View>

                {summary.swatchCount > 0 && (
                  <Text style={styles.swatchNote}>+{summary.swatchCount} kartela okutuldu</Text>
                )}

                {covTotal > 0 && (
                  <View style={styles.coverWrap}>
                    <View style={styles.coverHead}>
                      <Text style={styles.coverLabel}>Karşılama</Text>
                      <Text style={styles.coverCount}>
                        {okCount}/{covTotal} satır tamam
                      </Text>
                    </View>
                    <ProgressBar progress={covProgress} color={colors.successDark} style={styles.progress} />
                  </View>
                )}
              </Surface>
            </AnimatedEntrance>

            {/* ── Birincil aksiyon: Top Okut ── */}
            <AnimatedEntrance index={1}>
              <Button
                mode="contained"
                icon="barcode-scan"
                buttonColor={colors.brand}
                onPress={() => setScanOpen(true)}
                style={styles.scanBtn}
                contentStyle={styles.scanBtnContent}
                labelStyle={styles.scanBtnLabel}
              >
                Top Okut
              </Button>
            </AnimatedEntrance>

            {/* ── Karşılama detayı ── */}
            {covTotal > 0 && (
              <AnimatedEntrance index={2}>
                <Surface style={styles.card} elevation={0}>
                  <Text style={styles.cardTitle}>Karşılama</Text>
                  {covRows.map((r, i) => {
                    const remaining = Math.max(0, r.openQty - r.thisShipment);
                    const ok = remaining <= 0;
                    const progress = r.openQty > 0 ? Math.min(1, r.thisShipment / r.openQty) : ok ? 1 : 0;
                    return (
                      <View key={r.key} style={[styles.covRow, i > 0 && styles.rowBorder]}>
                        <Text style={styles.covSpec} numberOfLines={2}>
                          {r.order} · {r.name}
                          {r.colorName ? ` · ${r.colorName}` : ''}
                          {r.width ? ` · ${r.width}cm` : ''}
                        </Text>

                        <Text style={styles.covNums}>
                          <Text style={styles.covNumLabel}>okutulan </Text>
                          <Text style={[styles.covNumValue, { color: ok ? colors.successDark : colors.brand }]}>
                            {Math.round(r.thisShipment)}
                          </Text>
                          <Text style={styles.covNumLabel}> / istenen </Text>
                          <Text style={styles.covNumValue}>{Math.round(r.openQty)}</Text>
                          <Text style={styles.covNumLabel}> m</Text>
                        </Text>

                        <View style={styles.covBarRow}>
                          <ProgressBar
                            progress={progress}
                            color={ok ? colors.successDark : colors.brand}
                            style={styles.covBar}
                          />
                          <Text style={[styles.covStatus, ok ? styles.covStatusOk : styles.covStatusShort]}>
                            {ok ? '✓ tamam' : `${Math.round(remaining)} m eksik`}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </Surface>
              </AnimatedEntrance>
            )}

            {/* ── Okutulan toplar ── */}
            <AnimatedEntrance index={3}>
              <Surface style={styles.card} elevation={0}>
                <Text style={styles.cardTitle}>Okutulan Toplar ({rolls.length})</Text>
                {rolls.length === 0 ? (
                  <View style={styles.empty}>
                    <Icon source="barcode-off" size={30} color={colors.borderStrong} />
                    <Text style={styles.emptyText}>Henüz top okutulmadı</Text>
                    <Text style={styles.emptyHint}>“Top Okut” ile depodan top ekleyin.</Text>
                  </View>
                ) : (
                  rolls.map((r, i) => (
                    <View key={r.id} style={[styles.itemRow, i > 0 && styles.rowBorder]}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.barcodeChip}>
                          <Text style={styles.barcodeChipText}>{r.barcode ?? '—'}</Text>
                        </View>
                        <Text style={styles.covMeta}>
                          {r.item.name}
                          {r.color ? ` · ${r.color.name}` : ''} · {Math.round(r.currentQty)}m
                        </Text>
                      </View>
                      <IconButton
                        icon="close-circle"
                        size={22}
                        iconColor={colors.danger}
                        onPress={() => removeRollMut.mutate(r.id)}
                      />
                    </View>
                  ))
                )}
              </Surface>
            </AnimatedEntrance>

            {/* ── Çuvallar ── */}
            <AnimatedEntrance index={4}>
              <Surface style={styles.card} elevation={0}>
                <View style={styles.cardHeadRow}>
                  <Text style={styles.cardTitle}>Çuvallar ({sacks.length})</Text>
                  <Button compact mode="contained-tonal" icon="plus" onPress={() => setSackOpen(true)}>
                    Çuval Ekle
                  </Button>
                </View>
                {sacks.length === 0 ? (
                  <View style={styles.empty}>
                    <Icon source="sack" size={30} color={colors.borderStrong} />
                    <Text style={styles.emptyText}>Henüz çuval yok</Text>
                    <Text style={styles.emptyHint}>“Çuval Ekle” ile tartı girin.</Text>
                  </View>
                ) : (
                  sacks.map((s, i) => (
                    <View key={s.id} style={[styles.itemRow, i > 0 && styles.rowBorder]}>
                      <View style={styles.sackIcon}>
                        <Icon source="sack" size={18} color={colors.textSecondary} />
                      </View>
                      <Text style={styles.sackLabel}>Çuval {s.seq}</Text>
                      <Text style={styles.sackKg}>{(s.weightKg ?? 0).toLocaleString('tr-TR')} kg</Text>
                      <IconButton
                        icon="close-circle"
                        size={22}
                        iconColor={colors.danger}
                        onPress={() => removeSackMut.mutate(s.id)}
                      />
                    </View>
                  ))
                )}
              </Surface>
            </AnimatedEntrance>
          </ScrollView>

          {/* ── Sabit alt: Sevke Hazır ── */}
          <View style={styles.footer}>
            {!canReady && <Text style={styles.footerHint}>En az 1 top okut + 1 çuval tart.</Text>}
            <Button
              mode="contained"
              icon="truck-check"
              buttonColor={colors.successDark}
              disabled={!canReady || readyMut.isPending}
              loading={readyMut.isPending}
              onPress={() => readyMut.mutate()}
              contentStyle={styles.footerBtnContent}
              labelStyle={styles.footerBtnLabel}
            >
              Sevke Hazır
            </Button>
          </View>
        </>
      )}

      <BarcodeScannerModal
        visible={scanOpen}
        onDismiss={() => setScanOpen(false)}
        onScan={handleScan}
        title="Depodan top okut"
        continuous
      />

      <RNModal isVisible={sackOpen} onBackdropPress={() => setSackOpen(false)} style={styles.modal} {...modalProps}>
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
            style={{ marginVertical: spacing.md }}
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
              buttonColor={colors.successDark}
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

      <RNModal isVisible={cancelOpen} onBackdropPress={() => setCancelOpen(false)} style={styles.modal} {...modalProps}>
        <Surface style={styles.sheet} elevation={4}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            Sevkiyatı İptal Et
          </Text>
          {cancelPreviewQ.isLoading || !cancelPreview ? (
            <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.brand} />
          ) : (
            <>
              <Text style={styles.covMeta}>
                {cancelPreview.rolls.length} top depoya dönecek
                {cancelPreview.affectedOrders.length > 0
                  ? ` · ${cancelPreview.affectedOrders.length} siparişin karşılanması geri alınacak`
                  : ''}
                .
              </Text>
              <ScrollView style={{ maxHeight: 200, marginTop: spacing.sm }}>
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
              buttonColor={colors.danger}
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },

  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  loadingText: { fontSize: typography.size.sm, color: colors.textMuted },

  // ── Hero ──
  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCustomer: { fontSize: typography.size.lg, fontWeight: '700', color: colors.text },
  heroBranch: { fontSize: typography.size.sm, color: colors.textSecondary, marginTop: 1 },
  draftChip: {
    backgroundColor: colors.warningContainer,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  draftChipText: { fontSize: typography.size.xs, fontWeight: '700', color: colors.warningText },

  kpiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  kpi: { flex: 1, alignItems: 'center' },
  kpiSep: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border, marginVertical: spacing.xs },
  kpiNum: { fontSize: typography.size.xxl, fontWeight: '700', color: colors.text },
  kpiLabel: { fontSize: typography.size.xs, color: colors.textMuted, marginTop: 1 },

  swatchNote: { fontSize: typography.size.xs, color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' },

  coverWrap: { marginTop: spacing.lg },
  coverHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  coverLabel: { fontSize: typography.size.sm, fontWeight: '700', color: colors.text },
  coverCount: { fontSize: typography.size.xs, fontWeight: '600', color: colors.textSecondary },
  progress: { height: 8, borderRadius: radius.full, backgroundColor: colors.surfaceSunken },

  // ── Top Okut CTA ──
  scanBtn: { borderRadius: radius.md },
  scanBtnContent: { height: 54 },
  scanBtnLabel: { fontSize: typography.size.base, fontWeight: '700', letterSpacing: 0.3 },

  // ── Kartlar ──
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { fontSize: typography.size.base, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },

  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },

  // Karşılama satırı
  covRow: { paddingVertical: spacing.md, gap: spacing.xs },
  covSpec: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: '600' },
  covMeta: { fontSize: typography.size.xs, color: colors.textMuted, marginTop: 2 },

  // İstenen / okutulan — satırın en baskın bilgisi
  covNums: { marginTop: spacing.xs },
  covNumLabel: { fontSize: typography.size.sm, color: colors.textMuted, fontWeight: '500' },
  covNumValue: { fontSize: typography.size.xl, fontWeight: '700', color: colors.text },

  covBarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  covBar: { flex: 1, height: 8, borderRadius: radius.full, backgroundColor: colors.surfaceSunken },
  covStatus: { fontSize: typography.size.sm, fontWeight: '700' },
  covStatusOk: { color: colors.successText },
  covStatusShort: { color: colors.warningText },

  // Top / çuval satırı
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.sm },
  barcodeChip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.successContainer,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  barcodeChipText: { fontFamily: 'monospace', fontSize: typography.size.sm, fontWeight: '700', color: colors.successText },

  sackIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sackLabel: { flex: 1, fontSize: typography.size.sm, fontWeight: '700', color: colors.text },
  sackKg: { fontSize: typography.size.sm, fontWeight: '600', color: colors.textSecondary },

  // Boş durum
  empty: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.xs },
  emptyText: { fontSize: typography.size.sm, fontWeight: '600', color: colors.textMuted },
  emptyHint: { fontSize: typography.size.xs, color: colors.textMuted },

  // ── Sabit alt footer ──
  footer: {
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  footerHint: { fontSize: typography.size.xs, color: colors.textMuted, textAlign: 'center' },
  footerBtnContent: { height: 54 },
  footerBtnLabel: { fontSize: typography.size.base, fontWeight: '700', letterSpacing: 0.3 },

  // ── Modal'lar ──
  modal: { justifyContent: 'center', margin: spacing.lg },
  sheet: { borderRadius: radius.lg, padding: spacing.lg, backgroundColor: colors.surface },
  sheetTitle: { fontWeight: '700', marginBottom: spacing.xs, color: colors.text },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flex: 1 },
});

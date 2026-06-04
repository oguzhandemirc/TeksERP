import React, { useEffect, useRef, useState } from 'react';
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
  TouchableRipple,
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
// Paketleme — ÇUVAL-ÖNCE akış. Param: { orderIds } (yeni) veya { shipmentId }.
// Çuval aç → topları O çuvala okut → tart → kapat → sıradaki çuval. Top başka
// çuvala tek dokunuşla aktarılır. Sevke Hazır: her top çuvalda + her çuval tartılı.
// =============================================================================

// Bizdeki ad + (karşıdaki ad) — alias farklıysa parantezde.
const dualName = (ourName: string, custName?: string | null) =>
  custName && custName.trim() && custName !== ourName ? `${ourName} (${custName})` : ourName;

const kgText = (kg: number | null) => (kg != null ? `${kg.toLocaleString('tr-TR')} kg` : 'tartılmadı');
const randKg = () => (Math.round((10 + Math.random() * 90) * 10) / 10).toString();

export default function PaketlemeScreen() {
  // Portrait kilidi yalnızca telefonda — tablette yatay kalsın.
  usePortraitLock(useDeviceType() === 'phone');
  const modalProps = useFullscreenModalProps();
  const qc = useQueryClient();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, 'Paketleme'>>();
  const params = route.params ?? {};

  const [shipmentId, setShipmentId] = useState<string | null>(params.shipmentId ?? null);
  const [draftOrderIds, setDraftOrderIds] = useState<string[] | null>(params.orderIds ?? null);
  const [scanOpen, setScanOpen] = useState<boolean>(!params.shipmentId && !!params.orderIds);
  const [cancelOpen, setCancelOpen] = useState(false);

  // Aktif çuval — okutma buraya yazılır. State (render) + ref (scan callback yarışını önler).
  const [activeSackId, setActiveSackId] = useState<string | null>(null);
  const activeSackRef = useRef<string | null>(null);
  const setActiveSack = (id: string | null) => {
    activeSackRef.current = id;
    setActiveSackId(id);
  };

  const [weighTarget, setWeighTarget] = useState<{ id: string; seq: number } | null>(null);
  const [weighKg, setWeighKg] = useState('');
  const [moveTarget, setMoveTarget] = useState<{ rollId: string; fromSackId: string | null; label: string } | null>(null);

  const scanBusy = useRef(false);
  const ensureRef = useRef<Promise<string> | null>(null);
  const ensureSackRef = useRef<Promise<string> | null>(null);

  // Taslak karşılaması için açık siparişler (cache'ten gelir).
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

  const refreshShip = (id: string | null = shipmentId) =>
    void qc.invalidateQueries({ queryKey: ['shipment', id] });
  const finishAndBack = () => {
    void qc.invalidateQueries({ queryKey: ['open-orders'] });
    void qc.invalidateQueries({ queryKey: ['shipments'] });
    nav.goBack();
  };

  // Geç oluştur — ilk aksiyon anında sevkiyatı yarat (eşzamanlı çağrılarda tek kez).
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

  // Aktif çuval yoksa bir tane aç (okutmadan önce). Çoklu scan'de tek kez.
  const ensureActiveSack = (id: string): Promise<string> => {
    const cur = activeSackRef.current;
    if (cur) return Promise.resolve(cur);
    if (ensureSackRef.current) return ensureSackRef.current;
    const p = packingService
      .addSack(id)
      .then((res) => {
        const sid = res.data.id;
        setActiveSack(sid);
        return sid;
      })
      .finally(() => {
        ensureSackRef.current = null;
      });
    ensureSackRef.current = p;
    return p;
  };

  const sacks = ship?.sacks ?? [];
  const rolls = ship?.rolls ?? [];
  const summary = ship?.summary ?? { rollCount: 0, swatchCount: 0, totalMeters: 0, sackCount: 0, totalKg: 0 };

  // Aktif çuval geçersiz/yoksa son çuvala düşür (sacks değişince).
  const sackKey = sacks.map((s) => s.id).join(',');
  useEffect(() => {
    const ids = sacks.map((s) => s.id);
    if (ids.length === 0) {
      if (activeSackRef.current) setActiveSack(null);
      return;
    }
    if (!activeSackRef.current || !ids.includes(activeSackRef.current)) {
      setActiveSack(ids[ids.length - 1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sackKey]);

  const openSackMut = useMutation({
    mutationFn: async () => {
      const id = await ensureShipment();
      const res = await packingService.addSack(id);
      return { id, sack: res.data };
    },
    onSuccess: ({ id, sack }) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setActiveSack(sack.id);
      Toast.show({ type: 'success', text1: `Çuval ${sack.seq} açıldı`, text2: 'Topları bu çuvala okut.' });
      refreshShip(id);
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Çuval açılamadı', text2: e.message }),
  });

  const weighSackMut = useMutation({
    mutationFn: ({ sackId, kg }: { sackId: string; kg: number }) => packingService.weighSack(sackId, kg),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setWeighTarget(null);
      setWeighKg('');
      refreshShip();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Tartı kaydedilemedi', text2: e.message }),
  });

  const moveRollMut = useMutation({
    mutationFn: ({ rollId, sackId }: { rollId: string; sackId: string }) =>
      packingService.moveRollToSack(rollId, sackId),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Aktarıldı', text2: res.message });
      setMoveTarget(null);
      refreshShip();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Aktarılamadı', text2: e.message }),
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
      const sackId = await ensureActiveSack(id);
      const res = await packingService.scan(id, code, sackId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: res.data?.kind === 'SWATCH' ? 'Kartela eklendi' : 'Top eklendi',
        text2: res.message,
      });
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

  const activeSeq = sacks.find((s) => s.id === activeSackId)?.seq ?? null;
  const looseRolls = rolls.filter((r) => !r.sackId);
  const unweighed = sacks.filter((s) => (s.weightKg ?? 0) <= 0);
  const hasContent = summary.rollCount + summary.swatchCount > 0;
  const canReady =
    !isDraft && hasContent && sacks.length > 0 && looseRolls.length === 0 && unweighed.length === 0;

  let readyHint = '';
  if (!hasContent) readyHint = 'Önce çuvala top/kartela okut.';
  else if (sacks.length === 0) readyHint = 'En az bir çuval aç.';
  else if (looseRolls.length > 0) readyHint = `${looseRolls.length} top henüz çuvalda değil.`;
  else if (unweighed.length > 0) readyHint = `${unweighed.length} çuval tartılmadı.`;

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

  const openWeigh = (s: { id: string; seq: number; weightKg: number | null }) => {
    setWeighTarget({ id: s.id, seq: s.seq });
    setWeighKg(s.weightKg != null ? String(s.weightKg) : '');
  };

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
            {/* ── Hero: müşteri + KPI + karşılama ── */}
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
                    <Text style={styles.kpiLabel}>kg brüt</Text>
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

            {/* ── Birincil aksiyon: aktif çuvala Top Okut ── */}
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
                {activeSeq ? `Top Okut → Çuval ${activeSeq}` : 'Top Okut'}
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

            {/* ── Çuvalsız toplar (olmaması beklenir; defansif) ── */}
            {looseRolls.length > 0 && (
              <AnimatedEntrance index={3}>
                <Surface style={[styles.card, styles.warnCard]} elevation={0}>
                  <Text style={styles.cardTitle}>Çuvalsız Toplar ({looseRolls.length})</Text>
                  <Text style={styles.emptyHint}>Bu toplar bir çuvala konmalı (Sevke Hazır için).</Text>
                  {looseRolls.map((r, i) => (
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
                        icon="sack"
                        size={22}
                        iconColor={colors.brand}
                        onPress={() => setMoveTarget({ rollId: r.id, fromSackId: null, label: r.barcode ?? r.item.name })}
                        accessibilityLabel="Çuvala ekle"
                      />
                      <IconButton
                        icon="close-circle"
                        size={22}
                        iconColor={colors.danger}
                        onPress={() => removeRollMut.mutate(r.id)}
                      />
                    </View>
                  ))}
                </Surface>
              </AnimatedEntrance>
            )}

            {/* ── Çuvallar (içerikleriyle) ── */}
            <AnimatedEntrance index={4}>
              <Surface style={styles.card} elevation={0}>
                <View style={styles.cardHeadRow}>
                  <Text style={styles.cardTitle}>Çuvallar ({sacks.length})</Text>
                  <Button
                    compact
                    mode="contained-tonal"
                    icon="plus"
                    loading={openSackMut.isPending}
                    onPress={() => openSackMut.mutate()}
                  >
                    Yeni Çuval
                  </Button>
                </View>

                {sacks.length === 0 ? (
                  <View style={styles.empty}>
                    <Icon source="sack" size={30} color={colors.borderStrong} />
                    <Text style={styles.emptyText}>Henüz çuval yok</Text>
                    <Text style={styles.emptyHint}>“Yeni Çuval” aç ya da “Top Okut” — ilk çuval otomatik açılır.</Text>
                  </View>
                ) : (
                  sacks.map((s) => {
                    const active = s.id === activeSackId;
                    return (
                      <View key={s.id} style={[styles.sackCard, active && styles.sackCardActive]}>
                        <TouchableRipple
                          onPress={() => setActiveSack(s.id)}
                          style={styles.sackHead}
                          borderless={false}
                        >
                          <View style={styles.sackHeadRow}>
                            <View style={[styles.sackIcon, active && styles.sackIconActive]}>
                              <Icon source="sack" size={18} color={active ? colors.brand : colors.textSecondary} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <View style={styles.sackTitleRow}>
                                <Text style={styles.sackLabel}>Çuval {s.seq}</Text>
                                {active && (
                                  <View style={styles.activeTag}>
                                    <Text style={styles.activeTagText}>aktif</Text>
                                  </View>
                                )}
                              </View>
                              <Text style={styles.sackMeta}>
                                {s.rollCount} top
                                {s.swatchCount > 0 ? ` · ${s.swatchCount} kartela` : ''} · {kgText(s.weightKg)}
                              </Text>
                            </View>
                            <IconButton
                              icon="scale"
                              size={22}
                              iconColor={colors.textSecondary}
                              onPress={() => openWeigh(s)}
                              accessibilityLabel="Çuvalı tart"
                            />
                            <IconButton
                              icon="trash-can-outline"
                              size={22}
                              iconColor={colors.danger}
                              onPress={() => removeSackMut.mutate(s.id)}
                              accessibilityLabel="Çuvalı sil"
                            />
                          </View>
                        </TouchableRipple>

                        {s.rolls.length === 0 && s.swatchCount === 0 ? (
                          <Text style={styles.sackEmpty}>
                            {active ? 'Boş — “Top Okut” ile bu çuvala ekle' : 'Boş'}
                          </Text>
                        ) : (
                          <View style={styles.sackContent}>
                            {s.rolls.map((r) => (
                              <View key={r.id} style={styles.sackRollRow}>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.sackRollBarcode}>{r.barcode ?? '—'}</Text>
                                  <Text style={styles.covMeta}>
                                    {r.item.name}
                                    {r.color ? ` · ${r.color.name}` : ''} · {Math.round(r.currentQty)}m
                                  </Text>
                                </View>
                                {sacks.length > 1 && (
                                  <IconButton
                                    icon="swap-horizontal"
                                    size={20}
                                    iconColor={colors.brand}
                                    onPress={() =>
                                      setMoveTarget({ rollId: r.id, fromSackId: s.id, label: r.barcode ?? r.item.name })
                                    }
                                    accessibilityLabel="Başka çuvala aktar"
                                  />
                                )}
                                <IconButton
                                  icon="close-circle"
                                  size={20}
                                  iconColor={colors.danger}
                                  onPress={() => removeRollMut.mutate(r.id)}
                                />
                              </View>
                            ))}
                            {s.swatches.map((sw) => (
                              <View key={sw.id} style={styles.sackRollRow}>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.covMeta}>
                                    Kartela · {sw.item?.name ?? '—'}
                                    {sw.color ? ` · ${sw.color.name}` : ''}
                                    {sw.length != null ? ` · ${Math.round(sw.length)}cm` : ''}
                                  </Text>
                                </View>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    );
                  })
                )}
              </Surface>
            </AnimatedEntrance>
          </ScrollView>

          {/* ── Sabit alt: Sevke Hazır ── */}
          <View style={styles.footer}>
            {!canReady && <Text style={styles.footerHint}>{readyHint || 'Çuvala top okut + tart.'}</Text>}
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
        title={activeSeq ? `Çuval ${activeSeq}'e okut` : 'Depodan top okut'}
        continuous
      />

      {/* Tartı modalı */}
      <RNModal
        isVisible={weighTarget !== null}
        onBackdropPress={() => setWeighTarget(null)}
        style={styles.modal}
        {...modalProps}
      >
        <Surface style={styles.sheet} elevation={4}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            Çuval {weighTarget?.seq} — Brüt Tartı
          </Text>
          <TextInput
            mode="outlined"
            label="Brüt ağırlık (kg)"
            keyboardType="decimal-pad"
            value={weighKg}
            onChangeText={setWeighKg}
            autoFocus
            style={{ marginVertical: spacing.md }}
            right={<TextInput.Icon icon="scale" onPress={() => setWeighKg(randKg())} />}
          />
          <View style={styles.actions}>
            <Button onPress={() => setWeighTarget(null)} style={styles.actionBtn}>
              İptal
            </Button>
            <Button
              mode="contained"
              icon="check"
              buttonColor={colors.successDark}
              style={styles.actionBtn}
              loading={weighSackMut.isPending}
              disabled={weighSackMut.isPending || !(parseFloat(weighKg) > 0)}
              onPress={() => weighTarget && weighSackMut.mutate({ sackId: weighTarget.id, kg: parseFloat(weighKg) })}
            >
              Kaydet
            </Button>
          </View>
        </Surface>
      </RNModal>

      {/* Aktarma modalı — topu başka çuvala taşı */}
      <RNModal
        isVisible={moveTarget !== null}
        onBackdropPress={() => setMoveTarget(null)}
        style={styles.modal}
        {...modalProps}
      >
        <Surface style={styles.sheet} elevation={4}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            Topu Çuvala Taşı
          </Text>
          <Text style={styles.covMeta}>{moveTarget?.label}</Text>
          <ScrollView style={{ maxHeight: 280, marginTop: spacing.sm }}>
            {sacks
              .filter((s) => s.id !== moveTarget?.fromSackId)
              .map((s) => (
                <Button
                  key={s.id}
                  mode="outlined"
                  icon="sack"
                  style={{ marginBottom: spacing.sm }}
                  contentStyle={{ justifyContent: 'flex-start' }}
                  loading={moveRollMut.isPending}
                  disabled={moveRollMut.isPending}
                  onPress={() => moveTarget && moveRollMut.mutate({ rollId: moveTarget.rollId, sackId: s.id })}
                >
                  Çuval {s.seq} · {s.rollCount} top · {kgText(s.weightKg)}
                </Button>
              ))}
            {sacks.filter((s) => s.id !== moveTarget?.fromSackId).length === 0 && (
              <Text style={styles.emptyHint}>Başka çuval yok — önce yeni çuval aç.</Text>
            )}
          </ScrollView>
          <View style={styles.actions}>
            <Button onPress={() => setMoveTarget(null)} style={styles.actionBtn}>
              Kapat
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
  warnCard: { borderColor: colors.warningText, backgroundColor: colors.warningContainer },
  cardTitle: { fontSize: typography.size.base, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },

  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },

  // Karşılama satırı
  covRow: { paddingVertical: spacing.md, gap: spacing.xs },
  covSpec: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: '600' },
  covMeta: { fontSize: typography.size.xs, color: colors.textMuted, marginTop: 2 },

  covNums: { marginTop: spacing.xs },
  covNumLabel: { fontSize: typography.size.sm, color: colors.textMuted, fontWeight: '500' },
  covNumValue: { fontSize: typography.size.xl, fontWeight: '700', color: colors.text },

  covBarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  covBar: { flex: 1, height: 8, borderRadius: radius.full, backgroundColor: colors.surfaceSunken },
  covStatus: { fontSize: typography.size.sm, fontWeight: '700' },
  covStatusOk: { color: colors.successText },
  covStatusShort: { color: colors.warningText },

  // Genel satır (çuvalsız toplar)
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.sm },
  barcodeChip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.successContainer,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  barcodeChipText: { fontFamily: 'monospace', fontSize: typography.size.sm, fontWeight: '700', color: colors.successText },

  // ── Çuval kartı ──
  sackCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  sackCardActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  sackHead: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  sackHeadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sackIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sackIconActive: { backgroundColor: colors.surface },
  sackTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  sackLabel: { fontSize: typography.size.sm, fontWeight: '700', color: colors.text },
  sackMeta: { fontSize: typography.size.xs, color: colors.textSecondary, marginTop: 1 },
  activeTag: {
    backgroundColor: colors.brand,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  activeTagText: { fontSize: typography.size.xs, fontWeight: '700', color: colors.textOnDark },

  sackEmpty: {
    fontSize: typography.size.xs,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    fontStyle: 'italic',
  },
  sackContent: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sackRollRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 2 },
  sackRollBarcode: { fontFamily: 'monospace', fontSize: typography.size.sm, fontWeight: '700', color: colors.text },

  // Boş durum
  empty: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.xs },
  emptyText: { fontSize: typography.size.sm, fontWeight: '600', color: colors.textMuted },
  emptyHint: { fontSize: typography.size.xs, color: colors.textMuted, textAlign: 'center' },

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

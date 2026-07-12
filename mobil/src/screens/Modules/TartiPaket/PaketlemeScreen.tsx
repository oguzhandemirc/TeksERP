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
  TouchableRipple,
} from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import ScreenChrome from '../../../components/ScreenChrome';
import RefreshButton from '../../../components/RefreshButton';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import RollPickerModal from '../../../components/RollPickerModal';
import { KartelaStockPickerModal } from './KartelaStockPickerModal';
import { AnimatedEntrance, MarqueeText } from '../../../components/motion';
import { colors, palette, spacing, radius, shadow, typography } from '../../../theme';
import {
  packingService,
  shipmentDestinationLabels,
  type PoolSack,
  type KartelaStockGroup,
  type ShipmentDestination,
} from '../../../services/packing.service';
import { isWorkSessionLost } from '../../../services/api';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import {
  useMachinePeripherals,
  primaryScaleFor,
} from '../../../hooks/useMachinePeripherals';
import { buildIoFromPeripheral } from '../../../hooks/usePeripheralIO';
import { isBonded, pairByMac } from '../../../services/hal/btClassic.transport';
import {
  useShipmentConfirmationEnabled,
  FLAGS_KEY,
} from '../../../hooks/useFeatureFlags';
import type { MainStackParamList } from '../../../navigation/types';

// =============================================================================
// Paketleme — ÇUVAL DEPO akış (MÜŞTERİ-BAZLI). Param: { customerId, branchId? }.
// Ekran müşterinin havuz çuvallarını (/pool/sacks) canlı listeler:
//   Çuval aç → topları çuvala okut → tart + KOD (çuval depoda hazır kalır).
// Mühür yok — havuzdaki her çuval düzenlenebilir. "Hemen Sevk Et": bu müşterinin
// dolu çuvallarından SİPARİŞSİZ sevkiyat kurar; sevk onayı KAPALIYSA backend
// doğrudan sevk eder, AÇIKSA PLANNED bırakır (çıkış Sevk Çıkışı'ndan). Sipariş
// eşleştirme/karşılama backend'de (Sevk Çıkışı).
// =============================================================================

const kgText = (kg: number | null) => (kg != null ? `${kg.toLocaleString('tr-TR')} kg` : 'tartılmadı');
// Metraj — GERÇEK değeri göster (44,5 → "44,5"). tr-TR ondalık = virgül.
const mText = (m: number) => m.toLocaleString('tr-TR', { maximumFractionDigits: 2 });

const sackCode = (sk: PoolSack) => sk.sackNo;

export default function PaketlemeScreen() {
  // Portrait kilidi yalnızca telefonda — tablette yatay kalsın.
  usePortraitLock(useDeviceType() === 'phone');
  const qc = useQueryClient();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, 'Paketleme'>>();
  const customerId = route.params.customerId;
  const branchId = route.params.branchId ?? null;

  // Sevkiyat kapsamı (yurtiçi/yurtdışı) — sevkiyat KURULUMUNDA kullanılır (taslak).
  const [destination, setDestination] = useState<ShipmentDestination>('DOMESTIC');

  const [scanOpen, setScanOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [kartelaOpen, setKartelaOpen] = useState(false);
  // Listeden eklenen toplar — picker'da gizle (açık picker snapshot'ı anlık güncellenmez).
  const [pickedIds, setPickedIds] = useState<string[]>([]);

  // Aktif çuval — okutma buraya yazılır. State (render) + ref (scan callback yarışını önler).
  const [activeSackId, setActiveSackId] = useState<string | null>(null);
  const activeSackRef = useRef<string | null>(null);
  const setActiveSack = (id: string | null) => {
    activeSackRef.current = id;
    setActiveSackId(id);
  };

  // Saha #8: 300-çuval UX — arama + pencereleme (büyük listede hepsini render etme).
  const [sackSearch, setSackSearch] = useState('');
  const [showAllSacks, setShowAllSacks] = useState(false);
  const SACK_WINDOW = 20;

  const [weighTarget, setWeighTarget] = useState<{ id: string; label: string } | null>(null);
  const [weighKg, setWeighKg] = useState('');
  // Kantar (HAL): bu telefonun atandığı makinenin SCALE cihaz(lar)ı.
  const scalePeripherals = useMachinePeripherals('SCALE');
  const [weighing, setWeighing] = useState(false);

  // "Tart": kantardan brüt kg oku. Cihaz yoksa/okunamazsa NET Türkçe hata + null.
  const weighFromMachine = async (): Promise<number | null> => {
    const simWeigh = () => Math.round((10 + Math.random() * 90) * 10) / 10;
    const p = primaryScaleFor(scalePeripherals);
    if (!p) {
      Toast.show({
        type: 'error',
        text1: 'Kantar tanımlı değil',
        text2: 'Admin → Cihaz Kaydı’ndan bu makineye SCALE ekleyin (veya kg’yi elle girin).',
        visibilityTime: 6000,
      });
      return null;
    }
    if (p.simulate) return simWeigh();
    const io = buildIoFromPeripheral(p);
    if (!io.supported || !io.transport || !io.codec) {
      Toast.show({
        type: 'error',
        text1: 'Kantar okunamıyor',
        text2: 'Bu derlemede/bağlantı türünde desteklenmiyor (native build / connectionType).',
        visibilityTime: 6000,
      });
      return null;
    }
    if (p.connectionType === 'BLUETOOTH_SPP' && p.address) {
      try {
        if (!(await isBonded(p.address))) {
          Toast.show({
            type: 'info',
            text1: 'Kantar ilk kez eşleştiriliyor',
            text2: 'PIN sorulursa girin (ör. 1234) — sonraki tartılarda otomatik bağlanır.',
            visibilityTime: 8000,
          });
          await pairByMac(p.address);
        }
      } catch (e) {
        Toast.show({
          type: 'error',
          text1: 'Kantar eşleştirilemedi',
          text2: e instanceof Error ? e.message : 'Kantar açık ve menzilde mi? PIN girildi mi?',
          visibilityTime: 6000,
        });
        return null;
      }
    }
    try {
      const raw = await io.transport.read({
        readMode: p.readMode,
        pollCommand: p.pollCommand ?? undefined,
        terminator: p.terminator ?? undefined,
        timeoutMs: p.timeoutMs ?? undefined,
        framePattern: p.identifyPattern ?? undefined,
      });
      const v = io.codec.decode(raw);
      if (v != null && v > 0) return v;
      throw new Error('Geçerli tartı gelmedi');
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Kantar okunamadı',
        text2: e instanceof Error ? e.message : 'Kantar kapalı/menzil dışı veya komut yanlış olabilir',
        visibilityTime: 6000,
      });
      return null;
    }
  };

  const handleWeigh = async () => {
    if (weighing) return;
    setWeighing(true);
    try {
      const v = await weighFromMachine();
      if (v != null) setWeighKg(String(v));
    } finally {
      setWeighing(false);
    }
  };

  const [moveTarget, setMoveTarget] = useState<{ rollId: string; fromSackId: string; label: string } | null>(null);
  // Dolu çuval silme onayı — içindeki toplar (depoya dönecekler) somut listelenir.
  const [removeSackTarget, setRemoveSackTarget] = useState<PoolSack | null>(null);

  // Sevk onayı açık: createShipment PLANNED bırakır (çıkış Sevk Çıkışı'ndan).
  // Kapalı (varsayılan): backend doğrudan sevk eder (tek adım).
  const confirmationEnabled = useShipmentConfirmationEnabled();

  const scanBusy = useRef(false);
  const ensureSackRef = useRef<Promise<string> | null>(null);

  const poolQ = useQuery({
    queryKey: ['pool-sacks', customerId],
    queryFn: () => packingService.listCustomerPoolSacks(customerId),
    staleTime: 5_000,
  });
  const pool = poolQ.data?.data ?? null;
  const sacks = pool?.sacks ?? [];
  const customer = pool?.customer ?? null;

  // Render'dan bağımsız güncel çuval listesi (scan callback stale closure önlemi).
  const sacksRef = useRef<PoolSack[]>([]);
  sacksRef.current = sacks;

  const refreshPool = () => void qc.invalidateQueries({ queryKey: ['pool-sacks', customerId] });

  const refresh = useManualRefresh(
    () => {
      // Admin'in toggle ettiği bayrakları (sevk onayı) hemen yansıt.
      void qc.invalidateQueries({ queryKey: FLAGS_KEY });
      return poolQ.refetch();
    },
    'Çuvallar güncellendi',
  );
  const finishAndBack = () => {
    void qc.invalidateQueries({ queryKey: ['pool'] });
    void qc.invalidateQueries({ queryKey: ['pool-sacks', customerId] });
    void qc.invalidateQueries({ queryKey: ['open-orders'] });
    void qc.invalidateQueries({ queryKey: ['sack-store'] });
    nav.goBack();
  };

  // Aktif çuval yoksa bir çuval seç (okutmadan önce). Yoksa yeni aç.
  // Mühür yok → havuzdaki her çuval okutulabilir.
  const ensureActiveSack = (): Promise<string> => {
    const list = sacksRef.current;
    const cur = activeSackRef.current;
    // Aktif çuval varsa kullan (listede yoksa da: yeni açılmış, refetch gelmedi).
    if (cur) return Promise.resolve(cur);
    const existing = list[list.length - 1];
    if (existing) {
      setActiveSack(existing.id);
      return Promise.resolve(existing.id);
    }
    if (ensureSackRef.current) return ensureSackRef.current;
    const p = packingService
      .openSack({ customerId, branchId })
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

  // Seçerek kartela ekle — aktif çuvalı garanti et, sonra adet stoktan düş.
  const addKartelaFromStock = async (group: KartelaStockGroup, count: number): Promise<number> => {
    const sackId = await ensureActiveSack();
    const res = await packingService.addKartelaToSack(sackId, {
      itemId: group.itemId,
      colorId: group.colorId,
      count,
    });
    refreshPool();
    void qc.invalidateQueries({ queryKey: ['kartela', 'stock'] });
    return res.data?.added ?? count;
  };

  // Dolu (top/kartela içeren) çuvallar — "Hemen Sevk Et" bunları gönderir.
  const shippableSacks = sacks.filter((s) => s.rollCount + s.swatchCount > 0);
  const rollCount = sacks.reduce((a, s) => a + s.rollCount, 0);
  const swatchCount = sacks.reduce((a, s) => a + s.swatchCount, 0);
  const totalKg = sacks.reduce((a, s) => a + (s.weightKg ?? 0), 0);

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
    mutationFn: () => packingService.openSack({ customerId, branchId }),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setActiveSack(res.data.id);
      Toast.show({ type: 'success', text1: 'Çuval açıldı', text2: 'Topları bu çuvala okut.' });
      refreshPool();
    },
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return;
      Toast.show({ type: 'error', text1: 'Çuval açılamadı', text2: e.message });
    },
  });

  const weighSackMut = useMutation({
    mutationFn: ({ sackId, kg }: { sackId: string; kg: number }) =>
      packingService.weighSack(sackId, { weightKg: kg }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setWeighTarget(null);
      setWeighKg('');
      refreshPool();
    },
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return;
      Toast.show({ type: 'error', text1: 'Kaydedilemedi', text2: e.message });
    },
  });

  const moveRollMut = useMutation({
    mutationFn: ({ rollId, sackId }: { rollId: string; sackId: string }) =>
      packingService.moveRollToSack(rollId, sackId),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Aktarıldı', text2: res.message });
      setMoveTarget(null);
      refreshPool();
    },
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return;
      Toast.show({ type: 'error', text1: 'Aktarılamadı', text2: e.message });
    },
  });

  const removeSackMut = useMutation({
    mutationFn: ({ sackId, withContents }: { sackId: string; withContents?: boolean }) =>
      packingService.removeSack(sackId, withContents),
    onSuccess: (res, variables) => {
      setRemoveSackTarget(null);
      if (variables.withContents) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Toast.show({ type: 'success', text1: 'Çuval silindi', text2: res.message });
      }
      refreshPool();
    },
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return;
      Toast.show({ type: 'error', text1: 'Silinemedi', text2: e.message });
    },
  });

  const removeRollMut = useMutation({
    mutationFn: (rollId: string) => packingService.removeRollFromSack(rollId),
    onSuccess: () => refreshPool(),
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return;
      Toast.show({ type: 'error', text1: 'Çıkarılamadı', text2: e.message });
    },
  });

  // "Hemen Sevk Et" — dolu çuvallardan SİPARİŞSİZ sevkiyat kur. Sevk onayı kapalıysa
  // backend doğrudan sevk eder (dispatched=true); açıksa PLANNED bırakır. Sipariş
  // eşleştirme yapılmaz (orderIds boş).
  const shipMut = useMutation({
    mutationFn: async () => {
      const sackIds = shippableSacks.map((s) => s.id);
      const created = await packingService.createShipmentFromSacks({
        sackIds,
        customerId,
        branchId,
        orderIds: undefined,
        destination,
      });
      return created.data;
    },
    onSuccess: (data) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: data.dispatched ? 'Sevk edildi' : 'Sevkiyat kuruldu — Sevk Çıkışı’ndan onayla',
        text2: data.shipmentNo,
      });
      finishAndBack();
    },
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return;
      Toast.show({ type: 'error', text1: 'Sevkiyat kurulamadı', text2: e.message });
    },
  });

  // FIFO okuma kuyruğu — meşgulken gelen okumalar sırayla işlenir (yavaş ağda düşme yok).
  const pendingScansRef = useRef<string[]>([]);
  const processingCodeRef = useRef<string | null>(null);

  const drainScans = async (): Promise<void> => {
    if (scanBusy.current) return;
    const code = pendingScansRef.current.shift();
    if (!code) return;
    scanBusy.current = true;
    processingCodeRef.current = code;
    try {
      const sackId = await ensureActiveSack();
      const res = await packingService.scanIntoSack(sackId, code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: res.data?.kind === 'SWATCH' ? 'Kartela eklendi' : 'Top eklendi',
        text2: res.message,
      });
      refreshPool();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Eklenemedi', text2: (e as Error).message });
    } finally {
      setTimeout(() => {
        scanBusy.current = false;
        processingCodeRef.current = null;
        void drainScans();
      }, 600);
    }
  };

  const handleScan = (barcode: string) => {
    const code = barcode.trim();
    if (!code) return;
    if (processingCodeRef.current === code || pendingScansRef.current.includes(code)) return;
    pendingScansRef.current.push(code);
    void drainScans();
  };

  const activeSack = sacks.find((s) => s.id === activeSackId) ?? null;
  const activeLabel = activeSack ? sackCode(activeSack) : null;

  // Saha #8: görünür çuval kümesi (arama + pencereleme).
  const sackQ = sackSearch.trim().toLocaleLowerCase('tr');
  const isLargeSackList = sacks.length > SACK_WINDOW;
  const filteredSacks = sackQ
    ? sacks.filter((s) => s.sackNo.toLocaleLowerCase('tr').includes(sackQ))
    : sacks;
  const windowed = sackQ || showAllSacks || !isLargeSackList;
  const visibleSacks = windowed
    ? filteredSacks
    : filteredSacks.filter((s, i) => s.id === activeSackId || i >= filteredSacks.length - SACK_WINDOW);
  const hiddenSackCount = filteredSacks.length - visibleSacks.length;
  const expandContent = (id: string) => !isLargeSackList || id === activeSackId || Boolean(sackQ);

  // ── Sevk kısıtları — dolu çuval + (yurtdışı ise) tartı. Mühür/şube kısıtı yok.
  const requireWeigh = destination === 'EXPORT';
  const unweighed = shippableSacks.filter((s) => (s.weightKg ?? 0) <= 0);
  const canShip = shippableSacks.length > 0 && (!requireWeigh || unweighed.length === 0);

  let shipHint = '';
  if (shippableSacks.length === 0) shipHint = 'Dolu çuval yok — çuvala top/kartela okut.';
  else if (requireWeigh && unweighed.length > 0)
    shipHint = `${unweighed.length} çuval tartısız (yurtdışı — tartı zorunlu).`;

  const openWeigh = (sk: PoolSack) => {
    setWeighTarget({ id: sk.id, label: sackCode(sk) });
    setWeighKg(sk.weightKg != null ? String(sk.weightKg) : '');
  };

  const loadingReal = poolQ.isLoading || !pool;

  return (
    <ScreenChrome
      title=""
      onStepBack={() => nav.goBack()}
      headerExtras={
        <RefreshButton
          headerStyle
          onPress={refresh.onRefresh}
          refreshing={refresh.refreshing}
          isError={refresh.isError}
          errorMessage={refresh.errorMessage}
          successMessage={refresh.successMessage}
        />
      }
    >
      <View style={styles.subBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.subBarContent}
        >
          <Icon source="package-variant-closed" size={14} color={colors.textOnDarkMuted} />
          <Text style={styles.subBarTitle}>Paketleme</Text>
          <View style={styles.subBarDivider} />
          <Text style={styles.subBarCode}>{customer?.name ?? '—'}</Text>
        </ScrollView>
      </View>

      {loadingReal ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.loadingText}>Çuvallar yükleniyor…</Text>
        </View>
      ) : (
        <>
          <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>
            {/* ── Hero: müşteri + KPI + kapsam ── */}
            <AnimatedEntrance index={0}>
              <Surface style={styles.hero} elevation={0}>
                <View style={styles.heroTop}>
                  <View style={styles.heroIcon}>
                    <Icon source="package-variant-closed" size={22} color={colors.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroCustomer} numberOfLines={1}>
                      {customer?.name ?? '—'}
                    </Text>
                    <Text style={styles.heroBranch} numberOfLines={1}>
                      Çuval Havuzu · {sacks.length} çuval · {shippableSacks.length} dolu
                    </Text>
                  </View>
                </View>

                <View style={styles.kpiRow}>
                  <View style={styles.kpi}>
                    <Text style={styles.kpiNum}>{rollCount}</Text>
                    <Text style={styles.kpiLabel}>top</Text>
                  </View>
                  <View style={styles.kpiSep} />
                  <View style={styles.kpi}>
                    <Text style={styles.kpiNum}>{sacks.length}</Text>
                    <Text style={styles.kpiLabel}>çuval</Text>
                  </View>
                  <View style={styles.kpiSep} />
                  <View style={styles.kpi}>
                    <Text style={styles.kpiNum}>{totalKg.toLocaleString('tr-TR')}</Text>
                    <Text style={styles.kpiLabel}>kg brüt</Text>
                  </View>
                </View>

                {swatchCount > 0 && (
                  <Text style={styles.swatchNote}>+{swatchCount} kartela okutuldu</Text>
                )}

                {/* Saha #19: yurtiçi/yurtdışı — sevk kurulumunda kullanılır (yurtdışı: tartı zorunlu) */}
                <View style={styles.destRow}>
                  {(['DOMESTIC', 'EXPORT'] as const).map((d) => {
                    const active = destination === d;
                    return (
                      <TouchableRipple
                        key={d}
                        onPress={() => !active && setDestination(d)}
                        style={[
                          styles.destChip,
                          active && (d === 'EXPORT' ? styles.destChipExport : styles.destChipActive),
                        ]}
                        borderless
                      >
                        <Text style={[styles.destChipText, active && styles.destChipTextActive]}>
                          {shipmentDestinationLabels[d]}
                        </Text>
                      </TouchableRipple>
                    );
                  })}
                  {destination === 'EXPORT' && <Text style={styles.destHint}>çuval tartısı zorunlu</Text>}
                </View>
              </Surface>
            </AnimatedEntrance>

            {/* ── Çuvallar ── */}
            <AnimatedEntrance index={1}>
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

                {isLargeSackList && (
                  <TextInput
                    mode="outlined"
                    dense
                    placeholder="Çuval ara (kod)…"
                    value={sackSearch}
                    onChangeText={setSackSearch}
                    left={<TextInput.Icon icon="magnify" />}
                    right={
                      sackSearch ? <TextInput.Icon icon="close" onPress={() => setSackSearch('')} /> : undefined
                    }
                    style={styles.sackSearch}
                  />
                )}

                {sacks.length === 0 ? (
                  <View style={styles.empty}>
                    <Icon source="sack" size={30} color={colors.borderStrong} />
                    <Text style={styles.emptyText}>Henüz çuval yok</Text>
                    <Text style={styles.emptyHint}>“Yeni Çuval” aç ya da “Top Okut” — ilk çuval otomatik açılır.</Text>
                  </View>
                ) : filteredSacks.length === 0 ? (
                  <Text style={styles.sackEmpty}>“{sackSearch}” ile eşleşen çuval yok.</Text>
                ) : (
                  visibleSacks.map((s) => {
                    const active = s.id === activeSackId;
                    const num = sacks.indexOf(s) + 1;
                    return (
                      <View key={s.id} style={[styles.sackCard, active && styles.sackCardActive]}>
                        <View style={styles.sackHeadRow}>
                          <TouchableRipple
                            onPress={() => setActiveSack(s.id)}
                            style={styles.sackHeadTap}
                            borderless={false}
                          >
                            <View style={styles.sackHeadTapInner}>
                              <View style={[styles.sackIcon, active && styles.sackIconActive]}>
                                <Icon
                                  source="sack"
                                  size={18}
                                  color={active ? colors.brand : colors.textSecondary}
                                />
                              </View>
                              <View style={{ flex: 1 }}>
                                <View style={styles.sackTitleRow}>
                                  <Text style={styles.sackLabel}>Çuval {num}</Text>
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
                                <Text style={styles.sackMeta}>{s.sackNo}</Text>
                              </View>
                            </View>
                          </TouchableRipple>
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
                            onPress={() =>
                              s.rollCount > 0 || s.swatchCount > 0
                                ? setRemoveSackTarget(s)
                                : removeSackMut.mutate({ sackId: s.id })
                            }
                            accessibilityLabel="Çuvalı sil"
                          />
                        </View>

                        {s.rollCount + s.swatchCount === 0 ? (
                          <Text style={styles.sackEmpty}>
                            {active ? 'Boş — “Top Okut” ile bu çuvala ekle' : 'Boş'}
                          </Text>
                        ) : !expandContent(s.id) ? (
                          <Text style={styles.sackCollapsed}>
                            {s.rollCount} top — içeriği görmek için çuvala dokun
                          </Text>
                        ) : (
                          <View style={styles.sackContent}>
                            {s.rolls.map((r) => (
                              <View key={r.id} style={styles.sackRollRow}>
                                <View style={{ flex: 1 }}>
                                  <MarqueeText text={r.barcode ?? '—'} style={styles.sackRollBarcode} />
                                  <Text style={styles.covMeta}>
                                    {r.item.name}
                                    {r.color ? ` · ${r.color.name}` : ''} · {mText(r.currentQty)}m
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

                {hiddenSackCount > 0 && (
                  <Button mode="text" icon="chevron-down" onPress={() => setShowAllSacks(true)} style={{ marginTop: 4 }}>
                    {hiddenSackCount} çuval daha göster
                  </Button>
                )}
                {showAllSacks && isLargeSackList && !sackQ && (
                  <Button mode="text" icon="chevron-up" onPress={() => setShowAllSacks(false)} style={{ marginTop: 4 }}>
                    Listeyi daralt
                  </Button>
                )}
              </Surface>
            </AnimatedEntrance>
          </ScrollView>

          {/* ── Sabit alt: Hemen Sevk Et + okutma ── */}
          <View style={styles.footer}>
            {!canShip ? (
              <Text style={styles.footerBlockHint}>{shipHint || 'Çuvala top okut, tart.'}</Text>
            ) : (
              <Text style={styles.footerOrderlessHint}>
                Siparişsiz sevk — havuzdaki dolu çuvallar gider. Sipariş eşleştirme Sevk Çıkışı’nda.
              </Text>
            )}
            <View style={styles.footerRow}>
              <Button
                mode="contained"
                icon="truck-fast"
                buttonColor={colors.successDark}
                disabled={!canShip || shipMut.isPending}
                loading={shipMut.isPending}
                onPress={() => shipMut.mutate()}
                style={styles.footerBtnFlex}
                contentStyle={styles.footerBtnContent}
              >
                {confirmationEnabled
                  ? `Sevkiyat Kur${shippableSacks.length > 0 ? ` (${shippableSacks.length})` : ''}`
                  : `Hemen Sevk Et${shippableSacks.length > 0 ? ` (${shippableSacks.length})` : ''}`}
              </Button>
            </View>

            <View style={styles.scanRow}>
              <Button
                mode="contained-tonal"
                icon="format-list-bulleted"
                onPress={() => setListOpen(true)}
                style={styles.listBtn}
                contentStyle={styles.scanBtnContent}
              >
                Listeden
              </Button>
              <Button
                mode="contained-tonal"
                icon="layers"
                onPress={() => setKartelaOpen(true)}
                style={styles.listBtn}
                contentStyle={styles.scanBtnContent}
              >
                Kartela
              </Button>
              <Button
                mode="contained"
                icon="barcode-scan"
                buttonColor={colors.brand}
                onPress={() => setScanOpen(true)}
                style={styles.scanBtnFlex}
                contentStyle={styles.scanBtnContent}
                labelStyle={styles.scanBtnLabel}
              >
                {activeLabel ? `Top Okut → ${activeLabel}` : 'Top Okut'}
              </Button>
            </View>
          </View>
        </>
      )}

      <BarcodeScannerModal
        visible={scanOpen}
        onDismiss={() => setScanOpen(false)}
        onScan={handleScan}
        title={activeLabel ? `${activeLabel}'e okut` : 'Depodan top okut'}
        notice={activeLabel ? undefined : 'Taradığın toplar otomatik ilk çuvala eklenir.'}
        continuous
      />

      <RollPickerModal
        visible={listOpen}
        onDismiss={() => {
          setListOpen(false);
          setPickedIds([]);
        }}
        onSelect={(roll) => {
          setPickedIds((prev) => [...prev, roll.id]);
          void handleScan(roll.barcode ?? '');
        }}
        filters={{ status: 'WAREHOUSE', shipmentScope: 'free' }}
        title={activeLabel ? `${activeLabel}'e Top Seç` : 'Depodan Top Seç'}
        subtitle="Serbest depodaki toplar · seçince çuvala eklenir"
        excludeIds={[...pickedIds, ...sacks.flatMap((s) => s.rolls.map((r) => r.id))]}
        emptyText="Serbest depoda top yok"
        accent={colors.brand}
      />

      <KartelaStockPickerModal
        visible={kartelaOpen}
        onDismiss={() => setKartelaOpen(false)}
        onAdd={addKartelaFromStock}
      />

      {/* Çuval brüt tartısı. */}
      <AppModal
        visible={weighTarget !== null}
        onDismiss={() => setWeighTarget(null)}
        contentStyle={{ marginBottom: 160 }}
      >
        <Surface style={styles.sheet} elevation={4}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            {weighTarget?.label} — Brüt Tartı
          </Text>
          <TextInput
            mode="outlined"
            label="Brüt ağırlık (kg)"
            keyboardType="decimal-pad"
            value={weighKg}
            onChangeText={setWeighKg}
            autoFocus
            style={{ marginTop: spacing.md }}
            right={
              <TextInput.Icon
                icon={weighing ? 'progress-clock' : 'scale'}
                onPress={handleWeigh}
                disabled={weighing}
              />
            }
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
              onPress={() =>
                weighTarget &&
                parseFloat(weighKg) > 0 &&
                weighSackMut.mutate({ sackId: weighTarget.id, kg: parseFloat(weighKg) })
              }
            >
              Kaydet
            </Button>
          </View>
        </Surface>
      </AppModal>

      {/* Aktarma modalı — topu başka açık çuvala taşı */}
      <AppModal visible={moveTarget !== null} onDismiss={() => setMoveTarget(null)}>
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
                  {sackCode(s)} · {s.rollCount} top · {kgText(s.weightKg)}
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
      </AppModal>

      {/* Dolu çuval sil — depoya dönecek toplar somut listelenir. */}
      <AppModal visible={removeSackTarget !== null} onDismiss={() => setRemoveSackTarget(null)}>
        <Surface style={styles.sheet} elevation={4}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            {removeSackTarget ? sackCode(removeSackTarget) : ''} Sil
          </Text>
          <Text style={styles.covMeta}>
            Bu çuval silinince içindeki {removeSackTarget?.rollCount ?? 0} top depoya dönecek
            {removeSackTarget && removeSackTarget.swatchCount > 0
              ? ` (+${removeSackTarget.swatchCount} kartela)`
              : ''}
            . Topları tek tek çıkarmana gerek yok.
          </Text>
          <ScrollView style={{ maxHeight: 240, marginTop: spacing.sm }}>
            {(removeSackTarget?.rolls ?? []).map((r) => (
              <Text key={r.id} style={styles.covMeta}>
                • {r.barcode ?? '—'} · {r.item.name}
                {r.color ? ` · ${r.color.name}` : ''} · {mText(r.currentQty)}m
              </Text>
            ))}
            {(removeSackTarget?.swatchCount ?? 0) > 0 && (
              <Text style={styles.covMeta}>• +{removeSackTarget?.swatchCount} kartela depoya dönecek</Text>
            )}
          </ScrollView>
          <View style={styles.actions}>
            <Button onPress={() => setRemoveSackTarget(null)} style={styles.actionBtn}>
              Vazgeç
            </Button>
            <Button
              mode="contained"
              icon="trash-can-outline"
              buttonColor={colors.danger}
              style={styles.actionBtn}
              loading={removeSackMut.isPending}
              disabled={removeSackMut.isPending}
              onPress={() =>
                removeSackTarget && removeSackMut.mutate({ sackId: removeSackTarget.id, withContents: true })
              }
            >
              Sil — Depoya Döndür
            </Button>
          </View>
        </Surface>
      </AppModal>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },

  // ── Başlık şeridi (topbar altı, koyu tema, yatay kayar) ──
  subBar: {
    backgroundColor: palette.slate[800],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.slate[700],
  },
  subBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  subBarTitle: { fontSize: typography.size.sm, fontWeight: '700', color: colors.textOnDarkMuted },
  subBarDivider: { width: 1, height: 14, backgroundColor: palette.slate[600] },
  subBarCode: {
    fontSize: typography.size.sm,
    fontWeight: '700',
    color: colors.textOnDark,
    letterSpacing: 0.3,
  },

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

  destRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, justifyContent: 'center' },
  destChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  destChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  destChipExport: { backgroundColor: '#0284c7', borderColor: '#0284c7' },
  destChipText: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: '600' },
  destChipTextActive: { color: colors.textOnDark },
  destHint: { fontSize: typography.size.xs, color: colors.textSecondary, fontStyle: 'italic' },

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

  covMeta: { fontSize: typography.size.xs, color: colors.textMuted, marginTop: 2 },

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
  sackHeadRow: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.xs },
  sackHeadTap: { flex: 1 },
  sackHeadTapInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
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
  sackMetaWarn: { color: colors.warningText, fontWeight: '700' },
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
  sackSearch: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
  sackCollapsed: {
    fontSize: typography.size.xs,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
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
  // Sevk engeli (dolu çuval yok / tartısız) — muted değil, dikkat çeksin.
  footerBlockHint: {
    fontSize: typography.size.sm,
    color: colors.warningText,
    fontWeight: '700',
    textAlign: 'center',
  },
  // Siparişsiz sevk uyarısı — belirgin (marka rengi + kalın).
  footerOrderlessHint: {
    fontSize: typography.size.sm,
    color: colors.brand,
    fontWeight: '700',
    textAlign: 'center',
  },
  footerBtnContent: { height: 54 },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  footerBtnFlex: { flex: 1 },

  scanRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  listBtn: { borderRadius: radius.md },
  scanBtnFlex: { flex: 1, borderRadius: radius.md },
  scanBtnContent: { height: 54 },
  scanBtnLabel: { fontSize: typography.size.base, fontWeight: '700', letterSpacing: 0.3 },

  // ── Modal'lar ──
  sheet: { width: '100%', borderRadius: radius.lg, padding: spacing.lg, backgroundColor: colors.surface },
  sheetTitle: { fontWeight: '700', marginBottom: spacing.xs, color: colors.text },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flex: 1 },
});

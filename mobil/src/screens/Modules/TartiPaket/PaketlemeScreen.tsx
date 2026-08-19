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
import { generateClientUuid } from '../../../offline/barcode';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useSackWeigh } from '../../../hooks/useSackWeigh';
import SackActionsSheet, { type SackAction } from './SackActionsSheet';
import SackNoteSheet from './SackNoteSheet';
import SackManualWeightSheet from './SackManualWeightSheet';
import { SackLabelPrinter, type SackLabelJob } from '../../../components/labels/SackLabelPrinter';
import {
  useShipmentConfirmationEnabled,
  FLAGS_KEY,
} from '../../../hooks/useFeatureFlags';
import type { MainStackParamList } from '../../../navigation/types';
import { foldSearchText } from '../../../utils/searchFold';

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
// Çuval kodu mu (CV + GGAAYY + NNNN)? Çuval etiketi basıldığı için operatör bunu
// top okutma alanına okutabilir — top barkodu (T…H/F…) ile ayırt edilir.
const isSackCode = (code: string) => /^CV\d{10}$/i.test(code.trim());
// Tartı zamanı — yalnız saat:dakika (tarih kartta gürültü; çuval aynı gün tartılır).
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
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

  // ⋮ taşan aksiyonlar + yorum + elle kg sheet'leri.
  const [actionsTarget, setActionsTarget] = useState<PoolSack | null>(null);
  const [noteTarget, setNoteTarget] = useState<{ id: string; label: string; notes: string | null } | null>(null);
  const [manualWeighTarget, setManualWeighTarget] = useState<{ id: string; label: string; weightKg: number | null } | null>(null);
  const [printJob, setPrintJob] = useState<SackLabelJob | null>(null);

  const [moveTarget, setMoveTarget] = useState<{ rollId: string; fromSackId: string; label: string } | null>(null);
  // Dolu çuval silme onayı — içindeki toplar (depoya dönecekler) somut listelenir.
  const [removeSackTarget, setRemoveSackTarget] = useState<PoolSack | null>(null);

  // Sevk onayı açık: createShipment PLANNED bırakır (çıkış Sevk Çıkışı'ndan).
  // Kapalı (varsayılan): backend doğrudan sevk eder (tek adım).
  const confirmationEnabled = useShipmentConfirmationEnabled();

  const scanBusy = useRef(false);
  const ensureSackRef = useRef<Promise<string> | null>(null);

  // İdempotency (A4): token mantıksal "çuval aç" denemesi başına BİR kez üretilir —
  // timeout-retry AYNI token'la gider, backend mükerrer boş çuval yerine ilkini döner.
  // BAŞARIDA döndürülür (rotate) ki operatörün bilinçli "yeni çuval" isteği taze
  // token alsın; hatada korunur (retry koruması). HizliSiparisScreen emsali.
  const openSackTokenRef = useRef(generateClientUuid());
  const shipTokenRef = useRef(generateClientUuid());

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

  // Tartı: TEK DOKUNUŞ (oku → doğrudan kaydet). Modal yok; elle giriş ⋮ menüsünde.
  const sackWeigh = useSackWeigh(refreshPool);

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
      .openSack({ customerId, branchId, clientToken: openSackTokenRef.current })
      .then((res) => {
        openSackTokenRef.current = generateClientUuid(); // başarı → sonraki açılış taze token
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
    mutationFn: () => packingService.openSack({ customerId, branchId, clientToken: openSackTokenRef.current }),
    onSuccess: (res) => {
      openSackTokenRef.current = generateClientUuid(); // başarı → sonraki açılış taze token
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
        clientToken: shipTokenRef.current,
      });
      return created.data;
    },
    onSuccess: (data) => {
      shipTokenRef.current = generateClientUuid(); // başarı → taze token (ekran zaten kapanır)
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
      // ÇUVAL BARKODU (CV+GGAAYY+NNNN) okutulduysa bunu bir TOP sanıp backend'e
      // göndermek yanıltıcı "Top bulunamadı" verir. Çuval etiketi basılabildiği
      // için operatör kaçınılmaz olarak bunu okutacak → burada yakalanır ve o
      // çuval AKTİF yapılır (tamamen istemci; liste ve setActiveSack zaten elde).
      if (isSackCode(code)) {
        const target = sacksRef.current.find(
          (s) => s.sackNo.toLocaleUpperCase('tr') === code.toLocaleUpperCase('tr'),
        );
        if (target) {
          setActiveSack(target.id);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Toast.show({ type: 'success', text1: 'Çuval seçildi', text2: `${target.sackNo} artık aktif` });
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Toast.show({
            type: 'error',
            text1: 'Çuval bu havuzda değil',
            text2: `${code} bu müşterinin depo çuvalları arasında yok (sevk edilmiş olabilir).`,
            visibilityTime: 6000,
          });
        }
        return;
      }
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
  const sackQ = foldSearchText(sackSearch);
  const isLargeSackList = sacks.length > SACK_WINDOW;
  const filteredSacks = sackQ
    ? sacks.filter((s) => foldSearchText(s.sackNo).includes(sackQ))
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

  // ⋮ menüsü — kartta yer kaplamayan taşan aksiyonlar. Sık kullanılan (dokun=aktif,
  // ⚖=tart) kartta kalır; gerisi buraya. Silme onayı DEĞİŞMEZ: dolu çuval yine
  // etkilenen topları tek tek listeleyen onaydan geçer (yıkıcı-işlem kuralı).
  const buildSackActions = (sk: PoolSack): SackAction[] => [
    {
      key: 'manual-kg',
      icon: 'keyboard-outline',
      label: 'Elle kg gir',
      hint: sackWeigh.hasScale ? 'Kantar okunamazsa' : 'Bu yerde kantar tanımlı değil',
      onPress: () => setManualWeighTarget({ id: sk.id, label: sackCode(sk), weightKg: sk.weightKg }),
    },
    {
      key: 'label',
      icon: 'tag-outline',
      label: 'Etiket bas',
      hint: 'Barkod = çuval no · okutunca bu çuval aktif olur',
      onPress: () => setPrintJob({ sackId: sk.id, label: sackCode(sk) }),
    },
    {
      key: 'note',
      icon: 'comment-text-outline',
      label: sk.notes ? 'Notu düzenle' : 'Not ekle',
      hint: 'Kendimiz için — istenirse belgede de çıkar',
      onPress: () => setNoteTarget({ id: sk.id, label: sackCode(sk), notes: sk.notes }),
    },
    {
      key: 'delete',
      icon: 'trash-can-outline',
      label: 'Çuvalı sil',
      danger: true,
      onPress: () =>
        sk.rollCount > 0 || sk.swatchCount > 0
          ? setRemoveSackTarget(sk)
          : removeSackMut.mutate({ sackId: sk.id }),
    },
  ];

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
                    // paper'da `loading` tıklamayı ENGELLEMEZ — çift dokunuş + otomatik
                    // retry mükerrer boş çuval açardı; disabled ile in-flight kilitlenir.
                    loading={openSackMut.isPending}
                    disabled={openSackMut.isPending}
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
                                  {s.swatchCount > 0 ? ` · ${s.swatchCount} kartela` : ''} ·{' '}
                                  <Text style={s.weightKg != null ? styles.kgOk : undefined}>
                                    {kgText(s.weightKg)}
                                  </Text>
                                  {/* Tartı izi — tek dokunuş tartıdan sonra "hangi çuval tartıldı"
                                      modal açmadan görünür. */}
                                  {s.weightKg != null && s.weighedAt ? ` ✓ ${hhmm(s.weighedAt)}` : ''}
                                </Text>
                                <Text style={styles.sackMeta}>{s.sackNo}</Text>
                                {/* Not GÖSTERGESİ — dokunulamaz, yer kaplamaz; düzenleme ⋮'de. */}
                                {s.notes ? (
                                  <View style={styles.noteRow}>
                                    <Icon source="comment-text-outline" size={12} color={colors.textSecondary} />
                                    <Text style={styles.noteText} numberOfLines={1}>
                                      {s.notes}
                                    </Text>
                                  </View>
                                ) : null}
                              </View>
                            </View>
                          </TouchableRipple>
                          {/* TEK DOKUNUŞ tartı: kantardan oku → doğrudan kaydet. Modal YOK. */}
                          <IconButton
                            icon={sackWeigh.weighingSackId === s.id ? 'progress-clock' : 'scale'}
                            size={22}
                            iconColor={colors.textSecondary}
                            disabled={sackWeigh.busy}
                            onPress={() => void sackWeigh.weigh({ id: s.id, label: sackCode(s) })}
                            accessibilityLabel="Çuvalı tart (kantardan oku ve kaydet)"
                          />
                          <IconButton
                            icon="dots-vertical"
                            size={22}
                            iconColor={colors.textSecondary}
                            onPress={() => setActionsTarget(s)}
                            accessibilityLabel="Çuval işlemleri"
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

      {/* ⋮ taşan aksiyonlar (elle kg / yorum / sil) — tartı buradan DEĞİL, kartta tek dokunuş. */}
      <SackActionsSheet
        target={actionsTarget ? { id: actionsTarget.id, label: sackCode(actionsTarget) } : null}
        actions={actionsTarget ? buildSackActions(actionsTarget) : []}
        onDismiss={() => setActionsTarget(null)}
      />

      <SackNoteSheet target={noteTarget} onDismiss={() => setNoteTarget(null)} onSaved={refreshPool} />

      <SackLabelPrinter job={printJob} onDone={() => setPrintJob(null)} />

      <SackManualWeightSheet
        target={manualWeighTarget}
        onDismiss={() => setManualWeighTarget(null)}
        onSave={(kg) =>
          manualWeighTarget
            ? sackWeigh.saveManual({ id: manualWeighTarget.id, label: manualWeighTarget.label }, kg)
            : Promise.resolve(false)
        }
      />

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
  // Tartılmış çuvalın kg'si vurgulu — operatör tek bakışta hangisi eksik görsün.
  kgOk: { color: colors.successDark, fontWeight: '700' },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  noteText: { flex: 1, color: colors.textSecondary, fontSize: 11, fontStyle: 'italic' },
  sheet: { width: '100%', borderRadius: radius.lg, padding: spacing.lg, backgroundColor: colors.surface },
  sheetTitle: { fontWeight: '700', marginBottom: spacing.xs, color: colors.text },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flex: 1 },
});

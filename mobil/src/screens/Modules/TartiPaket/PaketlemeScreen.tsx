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
import AppModal from '../../../components/AppModal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import * as Print from 'expo-print';
import ScreenChrome from '../../../components/ScreenChrome';
import RefreshButton from '../../../components/RefreshButton';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import RollPickerModal from '../../../components/RollPickerModal';
import { KartelaStockPickerModal } from './KartelaStockPickerModal';
import type { KartelaStockGroup } from '../../../services/packing.service';
import { AnimatedEntrance, MarqueeText } from '../../../components/motion';
import { colors, palette, spacing, radius, shadow, typography } from '../../../theme';
import {
  packingService,
  shipmentDestinationLabels,
  type ShipmentSack,
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
import { getShipmentDispatchHtml } from '../../../services/shipmentDispatchPrint';
import type { MainStackParamList } from '../../../navigation/types';

// =============================================================================
// Paketleme — ÇUVAL-ÖNCE akış. Param: { orderIds } (yeni) veya { shipmentId }.
// Çuval aç → topları O çuvala okut → tart + KOD gir → kapat → sıradaki çuval. Top
// başka çuvala tek dokunuşla aktarılır. Sevke Hazır/Sevk: her top çuvalda + her çuval
// tartılı + kodlu. Onay kapalıysa "Hemen Sevk Et" kısayolu; açıksa çıkış ②'den onaylanır.
// =============================================================================

// Bizdeki ad + (karşıdaki ad) — alias farklıysa parantezde.
const dualName = (ourName: string, custName?: string | null) =>
  custName && custName.trim() && custName !== ourName ? `${ourName} (${custName})` : ourName;

const kgText = (kg: number | null) => (kg != null ? `${kg.toLocaleString('tr-TR')} kg` : 'tartılmadı');
// Metraj — GERÇEK değeri göster (44,5 → "44,5"). Math.round kullanma: 44,5 → 45
// yuvarlıyordu (yanlış miktar görünüyordu). tr-TR ondalık = virgül, gereksiz sıfır yok.
const mText = (m: number) => m.toLocaleString('tr-TR', { maximumFractionDigits: 2 });

export default function PaketlemeScreen() {
  // Portrait kilidi yalnızca telefonda — tablette yatay kalsın.
  usePortraitLock(useDeviceType() === 'phone');
  const qc = useQueryClient();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, 'Paketleme'>>();
  const params = route.params ?? {};

  const [shipmentId, setShipmentId] = useState<string | null>(params.shipmentId ?? null);
  const [draftOrderIds, setDraftOrderIds] = useState<string[] | null>(params.orderIds ?? null);
  // Saha #19: yeni sevkiyatın kapsamı — yurtiçi default. Sevkiyat oluşunca
  // backend'deki değer (ship.destination) otoritedir; bu yalnız create öncesi taslak.
  const [draftDestination, setDraftDestination] = useState<ShipmentDestination>('DOMESTIC');
  const [scanOpen, setScanOpen] = useState<boolean>(!params.shipmentId && !!params.orderIds);
  const [listOpen, setListOpen] = useState(false);
  const [kartelaOpen, setKartelaOpen] = useState(false);
  // Listeden eklenen toplar — picker'da gizle. Eklenen top backend'de committed
  // olur ama açık picker snapshot'ı anlık güncellenmez → çift-ekleme önlenir.
  // Modal kapanınca sıfırlanır.
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);

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
  const SACK_WINDOW = 20; // büyük listede aramasız görünen son çuval sayısı

  const [weighTarget, setWeighTarget] = useState<{ id: string; seq: number } | null>(null);
  const [weighKg, setWeighKg] = useState('');
  const [weighCode, setWeighCode] = useState('');
  // Kantar (HAL): bu telefonun atandığı makinenin SCALE cihaz(lar)ı. "Tart"
  // tuşu kantara HC-06 BT-SPP ile bağlanıp brüt kg okur (KK1 metresiyle aynı desen).
  const scalePeripherals = useMachinePeripherals('SCALE');
  const [weighing, setWeighing] = useState(false);

  // "Tart": kantardan brüt kg oku. Cihaz yoksa/okunamazsa NET Türkçe hata + null
  // (sessiz sahte YOK). simulate açıksa sahte kg (test/donanımsız). İstek-cevap
  // kantar pollCommand ile sorgulanır (readResponse yazıp yanıtı okur).
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
    // İlk kullanımda otomatik eşleştir (bond yoksa) — Bluetooth ayarlarına girmeden.
    // Uygulama MAC'ten createBond tetikler; Android PIN'i bir kez sorar (ör. 1234).
    // Bond sonrası bu blok atlanır → doğrudan bağlanıp okur.
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
  const [moveTarget, setMoveTarget] = useState<{ rollId: string; fromSackId: string | null; label: string } | null>(null);
  // Dolu çuval silme onayı — içindeki toplar (depoya dönecekler) somut listelenir.
  const [removeSackTarget, setRemoveSackTarget] = useState<ShipmentSack | null>(null);
  const [printing, setPrinting] = useState(false);

  // Sevk onayı açıksa ① yalnız "Sevke Hazır" yapar; kapalıysa "Hemen Sevk Et" kısayolu da görünür.
  const confirmationEnabled = useShipmentConfirmationEnabled();

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

  // Header "Yenile" — draft'ta açık siparişleri, kayıtlı sevkiyatta sevkiyatı tazeler.
  const refresh = useManualRefresh(
    () => {
      // Admin Electron'dan toggle ettiği bayrakları (sevk onayı → "Kapı Önüne Koy"/"Hemen Sevk Et")
      // 5 dk staleTime'ı beklemeden yansıt — operatör "Yenile"ye basınca footer güncellenir.
      void qc.invalidateQueries({ queryKey: FLAGS_KEY });
      return shipmentId === null ? openOrdersQ.refetch() : shipQ.refetch();
    },
    shipmentId === null ? 'Açık siparişler güncellendi' : 'Sevkiyat güncellendi',
  );
  const finishAndBack = () => {
    void qc.invalidateQueries({ queryKey: ['open-orders'] });
    void qc.invalidateQueries({ queryKey: ['shipments'] });
    nav.goBack();
  };

  // K-B1 fix: createShipment isteği zaman aşımına uğrarsa sevkiyat backend'de
  // OLUŞMUŞ olabilir — ekran bilmediği için "hayalet sevkiyat" kilidi doğuyordu
  // (operatörün kurtarma yolu yoktu). Transport hatasında PREPARING listesinde
  // bu siparişleri içeren sevkiyat aranır; bulunursa OTOMATİK ona bağlanılır.
  const recoverExistingShipment = async (orderIds: string[]): Promise<string | null> => {
    try {
      const list = await packingService.listShipments({ status: 'PREPARING' });
      for (const sh of list.data ?? []) {
        const det = await packingService.getShipment(sh.id);
        const shipOrderIds = (det.data?.orders ?? []).map((o) => o.id);
        if (orderIds.every((oid) => shipOrderIds.includes(oid))) return sh.id;
      }
    } catch {
      // kurtarma da başarısız — orijinal hata akışına düşülür
    }
    return null;
  };

  // Geç oluştur — ilk aksiyon anında sevkiyatı yarat (eşzamanlı çağrılarda tek kez).
  const ensureShipment = (): Promise<string> => {
    if (shipmentId) return Promise.resolve(shipmentId);
    if (ensureRef.current) return ensureRef.current;
    if (!draftOrderIds) return Promise.reject(new Error('Sipariş seçili değil'));
    const orderIds = draftOrderIds;
    const adopt = (id: string): string => {
      setShipmentId(id);
      setDraftOrderIds(null);
      void qc.invalidateQueries({ queryKey: ['shipments'] });
      void qc.invalidateQueries({ queryKey: ['open-orders'] });
      return id;
    };
    const p = packingService
      .createShipment(orderIds, draftDestination)
      .then((res) => {
        const id = res.data?.id;
        if (!id) throw new Error('Sevkiyat açılamadı');
        return adopt(id);
      })
      .catch(async (err: Error & { status?: number }) => {
        // Yalnız transport-düzeyi hatada (status yok = timeout/ağ — istek sunucuya
        // ulaşmış olabilir) kurtarma dene; backend reddi (4xx) gerçek hatadır.
        if (err.status == null) {
          const recovered = await recoverExistingShipment(orderIds);
          if (recovered) {
            Toast.show({
              type: 'info',
              text1: 'Mevcut sevkiyat bulundu',
              text2: 'Bağlantı sorununa rağmen sevkiyat açılmış — kaldığı yerden devam.',
            });
            return adopt(recovered);
          }
        }
        throw err;
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

  // Seçerek kartela ekle — sevkiyat + aktif çuvalı garanti et, sonra adet stoktan düş.
  const addKartelaFromStock = async (group: KartelaStockGroup, count: number): Promise<number> => {
    const id = await ensureShipment();
    const sackId = await ensureActiveSack(id);
    const res = await packingService.addKartela(id, {
      itemId: group.itemId,
      colorId: group.colorId,
      count,
      sackId,
    });
    refreshShip(id);
    void qc.invalidateQueries({ queryKey: ['kartela', 'stock'] });
    return res.data?.added ?? count;
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

  // Saha #19: yurtiçi/yurtdışı değiştir. Sevkiyat henüz oluşmadıysa taslak state'i
  // güncelle (create'te kullanılır); oluştuysa backend'e yaz.
  const destMut = useMutation({
    mutationFn: (d: ShipmentDestination) => packingService.setDestination(shipmentId!, d),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: res.message ?? 'Güncellendi' });
      refreshShip();
    },
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      Toast.show({ type: 'error', text1: 'Güncellenemedi', text2: e.message });
    },
  });
  const setDestination = (d: ShipmentDestination) => {
    if (shipmentId) destMut.mutate(d);
    else setDraftDestination(d);
  };
  const currentDestination: ShipmentDestination = ship?.destination ?? draftDestination;

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
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      Toast.show({ type: 'error', text1: 'Çuval açılamadı', text2: e.message });
    },
  });

  const weighSackMut = useMutation({
    mutationFn: ({ sackId, kg, code }: { sackId: string; kg: number; code: string }) =>
      packingService.weighSack(sackId, kg, code.trim()),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setWeighTarget(null);
      setWeighKg('');
      setWeighCode('');
      refreshShip();
    },
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
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
      refreshShip();
    },
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      Toast.show({ type: 'error', text1: 'Aktarılamadı', text2: e.message });
    },
  });

  const removeSackMut = useMutation({
    mutationFn: ({ sackId, withContents }: { sackId: string; withContents?: boolean }) =>
      packingService.removeSack(sackId, withContents),
    onSuccess: (res, variables) => {
      setRemoveSackTarget(null);
      // Kısa yol (dolu çuval) belirgin bir işlem → bildir; boş çuval sessizce silinir.
      if (variables.withContents) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Toast.show({ type: 'success', text1: 'Çuval silindi', text2: res.message });
      }
      refreshShip();
    },
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      Toast.show({ type: 'error', text1: 'Silinemedi', text2: e.message });
    },
  });

  const removeRollMut = useMutation({
    mutationFn: (rollId: string) => packingService.removeRoll(shipmentId!, rollId),
    onSuccess: () => refreshShip(),
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      Toast.show({ type: 'error', text1: 'Çıkarılamadı', text2: e.message });
    },
  });

  // "Çuval Depoya Kaldır" (markReady → READY): çuvallandı, firma içi depoda bekler (commit yapılır).
  const readyMut = useMutation({
    mutationFn: () => packingService.markReady(shipmentId!),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Çuval depoya kaldırıldı', text2: res.message });
      finishAndBack();
    },
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      Toast.show({ type: 'error', text1: 'Çuval depoya kaldırılamadı', text2: e.message });
    },
  });

  // "Kapı Önüne Koy" (moveToDoor → AT_DOOR): sevk onayı açıkken çıkışın durağı; "Alındı" bekler.
  const moveToDoorMut = useMutation({
    mutationFn: () => packingService.moveToDoor(shipmentId!),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Kapı önüne kondu', text2: res.message });
      finishAndBack();
    },
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      Toast.show({ type: 'error', text1: 'Kapı önüne konamadı', text2: e.message });
    },
  });

  // "Hemen Sevk Et" (onay kapalı): → DISPATCHED tek adım — stok düşer, irsaliye kesilir.
  const dispatchMut = useMutation({
    mutationFn: () => packingService.dispatch(shipmentId!, {}),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Sevk edildi', text2: res.message });
      finishAndBack();
    },
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      Toast.show({ type: 'error', text1: 'Sevk edilemedi', text2: e.message });
    },
  });

  // İrsaliye — DISPATCHED'da donmuş resmi belge, öncesi TASLAK (expo-print).
  const printNote = async (): Promise<void> => {
    if (!ship || !shipmentId) return;
    try {
      setPrinting(true);
      const html = await getShipmentDispatchHtml(shipmentId);
      await Print.printAsync({
        html,
        margins: { left: 0, top: 0, right: 0, bottom: 0 },
      });
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (!/did not complete|cancel/i.test(msg)) {
        Toast.show({ type: 'error', text1: 'Yazdırılamadı', text2: msg });
      }
    } finally {
      setPrinting(false);
    }
  };

  const cancelMut = useMutation({
    mutationFn: () => packingService.cancel(shipmentId!),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Sevkiyat iptal edildi', text2: res.message });
      setCancelOpen(false);
      finishAndBack();
    },
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      Toast.show({ type: 'error', text1: 'İptal edilemedi', text2: e.message });
    },
  });

  const cancelPreviewQ = useQuery({
    queryKey: ['shipment', shipmentId, 'cancel-preview'],
    queryFn: () => packingService.cancelPreview(shipmentId!),
    enabled: cancelOpen && shipmentId !== null,
    staleTime: 0,
  });
  const cancelPreview = cancelPreviewQ.data?.data ?? null;

  // O13 fix: meşgulken (yavaş Wi-Fi'de scan zinciri >800ms sürerken) gelen
  // okuma SESSİZCE düşüyordu — kamera yeşil ✓ + başarı haptiği vermişken top
  // çuvala hiç girmiyordu. Artık FIFO kuyruğa alınıp sırayla işlenir; aynı
  // barkodun ardışık kareleri (işlenen/kuyruktaki) yutulur.
  const pendingScansRef = useRef<string[]>([]);
  const processingCodeRef = useRef<string | null>(null);

  const drainScans = async (): Promise<void> => {
    if (scanBusy.current) return;
    const code = pendingScansRef.current.shift();
    if (!code) return;
    scanBusy.current = true;
    processingCodeRef.current = code;
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
        processingCodeRef.current = null;
        void drainScans(); // kuyrukta bekleyen varsa sıradakini işle
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

  const isDraft = shipmentId === null;
  const draftOrders = draftOrderIds ? openOrders.filter((o) => draftOrderIds.includes(o.order.id)) : [];
  const cust = ship?.customer ?? draftOrders[0]?.order.customer ?? null;
  const branch = ship?.branch ?? draftOrders[0]?.order.branch ?? null;

  const activeSeq = sacks.find((s) => s.id === activeSackId)?.seq ?? null;

  // Saha #8: görünür çuval kümesi. Arama varsa filtrele (kod/seq); yoksa büyük
  // listede yalnız aktif + son SACK_WINDOW çuval render edilir (300 çuval lag'ini
  // önler) — "Tümünü göster" ile açılır. İçerik (top satırları) yalnız küçük
  // listede VEYA aktif çuval VEYA aramada tam-eşleşmede açılır.
  const sackQ = sackSearch.trim().toLocaleLowerCase('tr');
  const isLargeSackList = sacks.length > SACK_WINDOW;
  const filteredSacks = sackQ
    ? sacks.filter(
        (s) => `${s.seq}` === sackQ || (s.manualCode ?? '').toLocaleLowerCase('tr').includes(sackQ),
      )
    : sacks;
  const windowed = sackQ || showAllSacks || !isLargeSackList;
  const visibleSacks = windowed
    ? filteredSacks
    : filteredSacks.filter((s, i) => s.id === activeSackId || i >= filteredSacks.length - SACK_WINDOW);
  const hiddenSackCount = filteredSacks.length - visibleSacks.length;
  const expandContent = (sackId: string) => !isLargeSackList || sackId === activeSackId || Boolean(sackQ);

  const looseRolls = rolls.filter((r) => !r.sackId);
  const unweighed = sacks.filter((s) => (s.weightKg ?? 0) <= 0);
  const uncoded = sacks.filter((s) => !s.manualCode || !s.manualCode.trim());
  const hasContent = summary.rollCount + summary.swatchCount > 0;
  // Saha #19: çuval tartısı YALNIZ yurtdışı (EXPORT) sevkte zorunlu — yurtiçi sevk
  // kg'sız çıkabilir (backend assertReadyInvariants ile birebir). Çuval kodu addSack'te
  // otomatik (AMB%05d) atandığından pratikte hep doludur → "Çuval Depoya"/"Hemen Sevk Et"
  // yurtiçinde tartı beklemeden aktif olur.
  const requireWeigh = currentDestination === 'EXPORT';
  const canReady =
    !isDraft &&
    hasContent &&
    sacks.length > 0 &&
    looseRolls.length === 0 &&
    (!requireWeigh || unweighed.length === 0) &&
    uncoded.length === 0;

  let readyHint = '';
  if (!hasContent) readyHint = 'Önce çuvala top/kartela okut.';
  else if (sacks.length === 0) readyHint = 'En az bir çuval aç.';
  else if (looseRolls.length > 0) readyHint = `${looseRolls.length} top henüz çuvalda değil.`;
  else if (requireWeigh && unweighed.length > 0) readyHint = `${unweighed.length} çuval tartılmadı (yurtdışı).`;
  else if (uncoded.length > 0) readyHint = `${uncoded.length} çuvalın kodu girilmedi.`;

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
  // Kamera modalı canlı sayacı — toplam metre (fazla okutmada gerçek rakam, kısıtlama yok).
  const totalWanted = covRows.reduce((a, r) => a + r.openQty, 0);
  const totalScanned = covRows.reduce((a, r) => a + r.thisShipment, 0);

  const loadingReal = shipmentId !== null && (shipQ.isLoading || !ship);

  const openWeigh = (s: { id: string; seq: number; weightKg: number | null; manualCode: string | null }) => {
    setWeighTarget({ id: s.id, seq: s.seq });
    setWeighKg(s.weightKg != null ? String(s.weightKg) : '');
    // Kod TEK sunucu kaynağından gelir (SACK_CODE_TEMPLATE — çuval açılışında
    // otomatik atanır, buraya dolu düşer). Eski istemci-tarafı <uuid>-DDMMYY-NNN
    // önerisi kaldırıldı: sunucu şablonuyla çelişen ikinci bir "otomatik" şemaydı.
    // Boş kod yalnız şablon-öncesi eski çuvallarda görülür — elle girilir.
    setWeighCode(s.manualCode?.trim() ? s.manualCode : '');
  };

  return (
    <ScreenChrome
      title=""
      onStepBack={() => nav.goBack()}
      headerExtras={
        <>
          <RefreshButton
            headerStyle
            onPress={refresh.onRefresh}
            refreshing={refresh.refreshing}
            isError={refresh.isError}
            errorMessage={refresh.errorMessage}
            successMessage={refresh.successMessage}
          />
          {!isDraft && (
            <>
              {hasContent && (
                <Appbar.Action
                  icon={printing ? () => <ActivityIndicator size={18} color={colors.textOnDark} /> : 'file-document-outline'}
                  color={colors.textOnDark}
                  disabled={printing}
                  onPress={printNote}
                  accessibilityLabel="Sevk irsaliyesi yazdır"
                />
              )}
              <Appbar.Action
                icon="trash-can-outline"
                color={colors.textOnDark}
                onPress={() => setCancelOpen(true)}
                accessibilityLabel="Sevkiyatı iptal et"
              />
            </>
          )}
        </>
      }
    >
      {/* Sevkiyat başlık şeridi — telefonda topbar'a sığmayan "Paketleme" + sevkiyat
          kodu burada, koyu temada yan yana; sığmazsa yatay kayar. */}
      <View style={styles.subBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.subBarContent}
        >
          <Icon source="package-variant-closed" size={14} color={colors.textOnDarkMuted} />
          <Text style={styles.subBarTitle}>Paketleme</Text>
          <View style={styles.subBarDivider} />
          <Text style={styles.subBarCode}>{ship?.shipmentNo ?? 'Yeni · kaydedilmedi'}</Text>
        </ScrollView>
      </View>

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

                {/* Saha #19: yurtiçi/yurtdışı — yurtiçi default, yurtdışında tartı zorunlu */}
                <View style={styles.destRow}>
                  {(['DOMESTIC', 'EXPORT'] as const).map((d) => {
                    const active = currentDestination === d;
                    return (
                      <TouchableRipple
                        key={d}
                        onPress={() => !active && setDestination(d)}
                        disabled={destMut.isPending}
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
                  {currentDestination === 'EXPORT' && (
                    <Text style={styles.destHint}>çuval tartısı zorunlu</Text>
                  )}
                </View>

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

            {/* ── Karşılama detayı ── */}
            {covTotal > 0 && (
              <AnimatedEntrance index={1}>
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
                            {mText(r.thisShipment)}
                          </Text>
                          <Text style={styles.covNumLabel}> / istenen </Text>
                          <Text style={styles.covNumValue}>{mText(r.openQty)}</Text>
                          <Text style={styles.covNumLabel}> m</Text>
                        </Text>

                        <View style={styles.covBarRow}>
                          <ProgressBar
                            progress={progress}
                            color={ok ? colors.successDark : colors.brand}
                            style={styles.covBar}
                          />
                          <Text style={[styles.covStatus, ok ? styles.covStatusOk : styles.covStatusShort]}>
                            {ok
                              ? r.thisShipment > r.openQty
                                ? `✓ +${mText(r.thisShipment - r.openQty)}m fazla`
                                : '✓ tamam'
                              : `${mText(remaining)} m eksik`}
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
              <AnimatedEntrance index={2}>
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
                          {r.color ? ` · ${r.color.name}` : ''} · {mText(r.currentQty)}m
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
            <AnimatedEntrance index={3}>
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

                {/* Saha #8: çok çuvalda arama/atla — kod veya sıra no ile */}
                {isLargeSackList && (
                  <TextInput
                    mode="outlined"
                    dense
                    placeholder="Çuval ara (kod veya sıra no)…"
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
                    return (
                      <View key={s.id} style={[styles.sackCard, active && styles.sackCardActive]}>
                        {/* Bilgi alanı = seçici (aktif çuval); ikonlar AYRI kardeş.
                            İç içe touchable yarışı (tartı modalı bazen açılmıyordu) önlenir. */}
                        <View style={styles.sackHeadRow}>
                          <TouchableRipple
                            onPress={() => setActiveSack(s.id)}
                            style={styles.sackHeadTap}
                            borderless={false}
                          >
                            <View style={styles.sackHeadTapInner}>
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
                                <Text
                                  style={[
                                    styles.sackMeta,
                                    !s.manualCode?.trim() && styles.sackMetaWarn,
                                  ]}
                                >
                                  {s.manualCode?.trim() ? `Kod: ${s.manualCode}` : 'Kod girilmedi'}
                                </Text>
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
                                ? setRemoveSackTarget(s) // dolu → önce onay (toplar depoya döner)
                                : removeSackMut.mutate({ sackId: s.id }) // boş → sessizce sil
                            }
                            accessibilityLabel="Çuvalı sil"
                          />
                        </View>

                        {s.rolls.length === 0 && s.swatchCount === 0 ? (
                          <Text style={styles.sackEmpty}>
                            {active ? 'Boş — “Top Okut” ile bu çuvala ekle' : 'Boş'}
                          </Text>
                        ) : !expandContent(s.id) ? (
                          // Saha #8: büyük listede içerik gizli (özet başlıkta) — dokun=aç
                          <Text style={styles.sackCollapsed}>
                            {s.rollCount} top — içeriği görmek için çuvala dokun
                          </Text>
                        ) : (
                          <View style={styles.sackContent}>
                            {s.rolls.map((r) => (
                              <View key={r.id} style={styles.sackRollRow}>
                                <View style={{ flex: 1 }}>
                                  {/* Barkod tek satır; sığmazsa OTOMATIK kayar (marquee). */}
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

                {/* Saha #8: pencereleme — gizli çuvalları aç */}
                {hiddenSackCount > 0 && (
                  <Button
                    mode="text"
                    icon="chevron-down"
                    onPress={() => setShowAllSacks(true)}
                    style={{ marginTop: 4 }}
                  >
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

          {/* ── Sabit alt: Çuval Depoya Kaldır + (onay açık → Kapı Önüne Koy / kapalı → Hemen Sevk Et) ── */}
          <View style={styles.footer}>
            {!canReady && <Text style={styles.footerHint}>{readyHint || 'Çuvala top okut.'}</Text>}
            <View style={styles.footerRow}>
              <Button
                mode="contained-tonal"
                icon="warehouse"
                disabled={!canReady || readyMut.isPending || moveToDoorMut.isPending || dispatchMut.isPending}
                loading={readyMut.isPending}
                onPress={() => readyMut.mutate()}
                style={styles.footerBtnFlex}
                contentStyle={styles.footerBtnContent}
              >
                Çuval Depoya
              </Button>
              {confirmationEnabled ? (
                // Onay açık: kapı önüne koy → çıkış ("Alındı") Sevk Çıkışı'ndan onaylanır.
                <Button
                  mode="contained"
                  icon="truck-fast"
                  buttonColor={colors.successDark}
                  disabled={!canReady || readyMut.isPending || moveToDoorMut.isPending}
                  loading={moveToDoorMut.isPending}
                  onPress={() => moveToDoorMut.mutate()}
                  style={styles.footerBtnFlex}
                  contentStyle={styles.footerBtnContent}
                >
                  Kapı Önüne Koy
                </Button>
              ) : (
                // Onay kapalı: hemen sevk et (stok düşer, müşteriye gitti).
                <Button
                  mode="contained"
                  icon="truck-fast"
                  buttonColor={colors.successDark}
                  disabled={!canReady || readyMut.isPending || dispatchMut.isPending}
                  loading={dispatchMut.isPending}
                  onPress={() => dispatchMut.mutate()}
                  style={styles.footerBtnFlex}
                  contentStyle={styles.footerBtnContent}
                >
                  Hemen Sevk Et
                </Button>
              )}
            </View>

            {/* ── En altta sabit: Listeden Seç + Top Okut (en sık aksiyon, baş parmağa
                en yakın) — depo/sevk butonlarının da altında durur. Kamera çalışsa bile
                operatör depodan listeyle de top seçebilir. ── */}
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
                {activeSeq ? `Top Okut → Çuval ${activeSeq}` : 'Top Okut'}
              </Button>
            </View>
          </View>
        </>
      )}

      <BarcodeScannerModal
        visible={scanOpen}
        onDismiss={() => setScanOpen(false)}
        onScan={handleScan}
        title={activeSeq ? `Çuval ${activeSeq}'e okut` : 'Depodan top okut'}
        notice={activeSeq ? undefined : 'Taradığın toplar otomatik ilk çuvala eklenir.'}
        counter={covTotal > 0 ? { scanned: totalScanned, expected: totalWanted } : undefined}
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
        title={activeSeq ? `Çuval ${activeSeq}'e Top Seç` : 'Depodan Top Seç'}
        subtitle="Serbest depodaki toplar · seçince çuvala eklenir"
        excludeIds={[...pickedIds, ...rolls.map((r) => r.id)]}
        emptyText="Serbest depoda top yok"
        accent={colors.brand}
      />

      <KartelaStockPickerModal
        visible={kartelaOpen}
        onDismiss={() => setKartelaOpen(false)}
        onAdd={addKartelaFromStock}
      />

      {/* Çuval kapat: kod + brüt tartı (ikisi de zorunlu). marginBottom → center
          yerleşiminde diyalogu yukarı kaydırır (kod+kg girişinde klavye altta
          modalı örtmesin diye biraz yukarıda dursun). */}
      <AppModal
        visible={weighTarget !== null}
        onDismiss={() => setWeighTarget(null)}
        contentStyle={{ marginBottom: 160 }}
      >
        <Surface style={styles.sheet} elevation={4}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            Çuval {weighTarget?.seq} — Kod + Brüt Tartı
          </Text>
          <TextInput
            mode="outlined"
            label="Çuval kodu (üstüne yazılan)"
            value={weighCode}
            onChangeText={setWeighCode}
            autoFocus
            autoCapitalize="characters"
            style={{ marginTop: spacing.md }}
          />
          <TextInput
            mode="outlined"
            label="Brüt ağırlık (kg)"
            keyboardType="decimal-pad"
            value={weighKg}
            onChangeText={setWeighKg}
            style={{ marginTop: spacing.sm }}
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
              disabled={weighSackMut.isPending || !(parseFloat(weighKg) > 0) || !weighCode.trim()}
              onPress={() =>
                weighTarget &&
                weighSackMut.mutate({ sackId: weighTarget.id, kg: parseFloat(weighKg), code: weighCode })
              }
            >
              Kaydet
            </Button>
          </View>
        </Surface>
      </AppModal>

      {/* Aktarma modalı — topu başka çuvala taşı */}
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
      </AppModal>

      {/* Dolu çuval sil — kısa yol. Depoya dönecek toplar somut listelenir; onaylanınca
          toplar tek tek çıkarılmadan çuval içeriğiyle silinir. */}
      <AppModal visible={removeSackTarget !== null} onDismiss={() => setRemoveSackTarget(null)}>
        <Surface style={styles.sheet} elevation={4}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            Çuval {removeSackTarget?.seq} Sil
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

      <AppModal visible={cancelOpen} onDismiss={() => setCancelOpen(false)}>
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
                    {r.colorName ? ` · ${r.colorName}` : ''} · {mText(r.currentQty)}m
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
      </AppModal>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },

  // ── Sevkiyat başlık şeridi (topbar altı, koyu tema, yatay kayar) ──
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
    fontFamily: 'monospace',
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

  // Saha #19: yurtiçi/yurtdışı seçim çipleri
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

  coverWrap: { marginTop: spacing.lg },
  coverHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  coverLabel: { fontSize: typography.size.sm, fontWeight: '700', color: colors.text },
  coverCount: { fontSize: typography.size.xs, fontWeight: '600', color: colors.textSecondary },
  progress: { height: 8, borderRadius: radius.full, backgroundColor: colors.surfaceSunken },

  // ── Top Okut CTA (sabit footer'ın en altında) ──
  scanBtn: { borderRadius: radius.md, marginTop: spacing.xs },
  scanRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  listBtn: { borderRadius: radius.md },
  scanBtnFlex: { flex: 1, borderRadius: radius.md },
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
  footerHint: { fontSize: typography.size.xs, color: colors.textMuted, textAlign: 'center' },
  footerBtnContent: { height: 54 },
  footerBtnLabel: { fontSize: typography.size.base, fontWeight: '700', letterSpacing: 0.3 },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  footerBtnFlex: { flex: 1 },

  // ── Modal'lar ──
  // width:'100%' — AppModal center'da contentStyle'sız çocuğa alignItems:'center'
  // uygular; açık genişlik olmadan Surface içeriğe büzülüp "ince uzun" taşıyordu.
  sheet: { width: '100%', borderRadius: radius.lg, padding: spacing.lg, backgroundColor: colors.surface },
  sheetTitle: { fontWeight: '700', marginBottom: spacing.xs, color: colors.text },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flex: 1 },
});

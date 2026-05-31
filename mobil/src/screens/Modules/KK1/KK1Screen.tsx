import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Keyboard,
  useWindowDimensions,
  TextInput as RNTextInput,
} from 'react-native';
import {
  Text,
  Button,
  ActivityIndicator,
  Surface,
  IconButton,
  Icon,
  TouchableRipple,
  Appbar,
  Switch,
} from 'react-native-paper';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import {
  useQuery,
  useMutation,
  useQueryClient,
  onlineManager,
} from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import Modal from 'react-native-modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import dayjs from 'dayjs';

import ScreenChrome from '../../../components/ScreenChrome';
import PickerModal, { PickerOption } from '../../../components/PickerModal';
import NumpadInput from '../../../components/NumpadInput';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useRefetchOnOpen } from '../../../hooks/useRefetchOnOpen';
import { NumpadHost } from '../../../components/NumpadProvider';
import RefreshButton from '../../../components/RefreshButton';
import { toastConfig } from '../../../components/ToastConfig';
import { LabelPrinter } from '../../../components/LabelPrinter';
import { itemService } from '../../../services/item.service';
import { rollService, InitialEntryRequest } from '../../../services/roll.service';
import { hardwareService } from '../../../services/hardware.service';
import { qualityGradeService } from '../../../services/qualityGrade.service';
import { STATION_MUT } from '../../../offline/mutations';
import { generateClientBarcode } from '../../../offline/barcode';
import SyncStatusChip from '../../../components/SyncStatusChip';
import ConfirmDialog from '../../../components/ConfirmDialog';
import {
  AnimatedEntrance,
  SkeletonList,
  PressableScale,
  AnimatedCounter,
  Pulse,
} from '../../../components/motion';
import { colors, radius, spacing } from '../../../theme';
import type { QualityGrade, Roll } from '../../../types/models';

const RECENT_PAGE_SIZE = 6;
const HISTORY_PAGE_SIZE = 20;

interface FormState {
  itemId: string;
  itemLabel: string;
  /** EN (cm) — kaydetler ARASI korunur (aynı en toptan onlarca seri giriş). */
  width: string;
  qualityGrade: string;
}

const EMPTY_FORM: FormState = {
  itemId: '',
  itemLabel: '',
  width: '',
  qualityGrade: '',
};

export default function KK1Screen() {
  // Telefon ekranında (kısa kenar < 600px) landscape kilidini kaldır —
  // kullanıcı portrait/landscape arasında serbestçe dönebilsin. Tabletlerde
  // önceki gibi landscape sabit.
  const device = useDeviceType();
  const compact = device === 'phone';
  useLandscapeLock(!compact);

  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  // Telefon dikey: son kayıtlar tetiği header'a taşınır, body'deki buton gizlenir.
  const { width: winW, height: winH } = useWindowDimensions();
  const portraitPhone = compact && winH > winW;
  // Compact'ta sağ panel drawer'a taşınır.
  const [recentsDrawerOpen, setRecentsDrawerOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pickerOpen, setPickerOpen] = useState<'item' | null>(null);
  const [pulling, setPulling] = useState(false);
  // Manuel mod: makine arızasında operatör mt + kg'yi elle girer. Varsayılan
  // kapalı (normalde değerler "Kaydet"e basınca makineden çekilir).
  const [manualMode, setManualMode] = useState(false);
  const [manualQty, setManualQty] = useState('');
  const [manualWeight, setManualWeight] = useState('');
  // Otomatik modda son okunan metraj — küçük info readout'ta gösterilir.
  const [lastMeter, setLastMeter] = useState<number | null>(null);
  // Metraj info'suna dokununca çıkan "elle override" uyarısı.
  const [meterWarnOpen, setMeterWarnOpen] = useState(false);
  // Bu oturumda kaydedilen top sayısı (seri girişte ilerleme hissi).
  const [sessionCount, setSessionCount] = useState(0);
  // Kaydet sonrası kısa "✓ Kaydedildi" başarı flaşı (CTA).
  const [justSaved, setJustSaved] = useState(false);
  // Listede yeni beliren topu kısa süre vurgulamak için.
  const [flashRollId, setFlashRollId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  // Etiket basımı — sıralı kuyruk. activePrintRoll = şu an LabelPrinter'a verilen
  // (null = boşta). printQueue = sırada bekleyenler. Offline'da N entry toplu
  // sync olduğunda hepsi print edilebilsin diye queue mantığı; ayrıca manuel
  // "Bas" tetikleri de aynı kuyruğa düşer.
  const [activePrintRoll, setActivePrintRoll] = useState<Roll | null>(null);
  const [printQueue, setPrintQueue] = useState<Roll[]>([]);

  // activePrint null ve queue dolu ise → bir sonrakini başlat. Print finish'te
  // activePrint = null olur, bu effect bir sonrakini alır. Sonsuz cycle yok
  // (queue boşalırsa effect no-op).
  useEffect(() => {
    if (activePrintRoll === null && printQueue.length > 0) {
      setActivePrintRoll(printQueue[0]);
      setPrintQueue((q) => q.slice(1));
    }
  }, [activePrintRoll, printQueue]);

  const enqueuePrint = useCallback((roll: Roll) => {
    setPrintQueue((q) => [...q, roll]);
  }, []);

  const handlePrintDone = useCallback(() => {
    setActivePrintRoll(null); // useEffect bir sonrakini alır
  }, []);
  // Scrap onay modal'ı — native Alert yerine kendi modalımız (alert telefon yönünü değiştiriyordu).
  const [scrapTarget, setScrapTarget] = useState<Roll | null>(null);
  // react-native-modal aynı anda iki modal'ı doğru stack edemiyor (Android Dialog
  // çakışması). Drawer / history açıkken scrap tıklanırsa hedef ref'e yazılır,
  // önce mevcut modal kapanır, onModalHide'da scrapTarget set edilir.
  const pendingScrapRef = useRef<Roll | null>(null);
  // Aynı iki-modal çakışması: drawer'dan "Tümünü Gör" → drawer kapanış
  // animasyonu bitmeden history açılırsa görünmez. Niyeti ref'e yaz, drawer
  // kapanınca (onModalHide) history'yi aç.
  const pendingHistoryRef = useRef(false);

  const widthRef = useRef<RNTextInput>(null);
  const manualQtyRef = useRef<RNTextInput>(null);
  const manualWeightRef = useRef<RNTextInput>(null);
  const recentsListRef = useRef<FlashListRef<Roll>>(null);

  // Numpad (tablet, sağ sütun): NumpadHost HER ZAMAN aktif kalır — varsayılan
  // hedef EN; manuel açıkken mt/kg'ye dokununca oraya yönlenir. blurAll artık
  // closeTarget ÇAĞIRMAZ (numpad disable olmasın); sadece native klavyeyi kapatır.
  const blurAll = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  // Manuel kapanınca (ve mount'ta) numpad varsayılan hedefi EN'e döner (tablet).
  // Operatör mt/kg'den çıkınca tuşlar yine En'i değiştirir.
  useEffect(() => {
    if (!compact && !manualMode) {
      requestAnimationFrame(() => widthRef.current?.focus());
    }
  }, [compact, manualMode]);

  // ── Items: kumaş (Variant kaldırıldı; RAW/DYED ayrımı yok artık) ──
  const itemsQuery = useQuery({
    queryKey: ['items', 'kk1', 'FABRIC'],
    queryFn: () =>
      itemService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: 'code',
        sortOrder: 'asc',
        filters: { isActive: 'true', itemType: 'FABRIC' },
      }),
  });

  // Item picker'ı her açıldığında listeyi tazele — admin yeni kumaş eklediyse
  // operatör Pull-to-refresh basmadan görsün.
  useRefetchOnOpen(itemsQuery.refetch, pickerOpen === 'item');

  const itemOptions = useMemo<PickerOption[]>(
    () =>
      (itemsQuery.data?.data ?? []).map((i) => ({
        value: i.id,
        label: i.name,
        sublabel: i.code,
      })),
    [itemsQuery.data]
  );

  // ── Kalite dereceleri (admin yönetimli katalog) ──
  const qualityGradesQuery = useQuery({
    queryKey: ['quality-grades', 'active'],
    queryFn: () => qualityGradeService.list({ pageSize: 100 }),
    staleTime: 10 * 60 * 1000,
  });
  // Stable referans: query.data undefined iken her render'da yeni `[]` üretmesin.
  const qualityGrades = useMemo(
    () => qualityGradesQuery.data?.data ?? [],
    [qualityGradesQuery.data],
  );

  // Liste yüklendiğinde / form sıfırlandığında ilk kaliteyi default seç
  useEffect(() => {
    if (!form.qualityGrade && qualityGrades.length > 0) {
      setForm((f) => ({ ...f, qualityGrade: qualityGrades[0].code }));
    }
  }, [qualityGrades, form.qualityGrade]);

  const handleQualityGradeSelect = useCallback(
    (code: string) => {
      blurAll();
      setForm((f) => ({ ...f, qualityGrade: code }));
    },
    [blurAll],
  );

  // ── Son kayıtlar (inline): SADECE 1. sayfa, az kayıt ──
  // entrySource=SUPPLIER_RECEIPT → KK1/manuel girişle gelen toplar (ham + bitmiş).
  // Backend enum'unda 'ALL' / 'PRODUCTION' YOK — status filtresi vermiyoruz ki
  // tüm statüsler (STOCK ham, WAREHOUSE renkli, vs.) görünsün.
  const recentRollsQuery = useQuery({
    queryKey: ['rolls', 'kk1', 'recent'],
    queryFn: () =>
      rollService.getAll({
        page: 1,
        pageSize: RECENT_PAGE_SIZE,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        filters: { entrySource: 'SUPPLIER_RECEIPT' },
      }),
  });

  // ── Tüm kayıtlar (modal): paginated ──
  const historyRollsQuery = useQuery({
    queryKey: ['rolls', 'kk1', 'history', historyPage],
    queryFn: () =>
      rollService.getAll({
        page: historyPage,
        pageSize: HISTORY_PAGE_SIZE,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        filters: { entrySource: 'SUPPLIER_RECEIPT' },
      }),
    enabled: historyOpen,
    placeholderData: (prev) => prev,
  });

  const totalCount = recentRollsQuery.data?.pagination.total ?? 0;
  const recentRolls = recentRollsQuery.data?.data ?? [];

  // Listede yeni kayıt belirdiğinde otomatik tepeye kaydır
  const topIdRef = useRef<string | null>(null);
  useEffect(() => {
    const newTopId = recentRolls[0]?.id ?? null;
    if (
      topIdRef.current !== null &&
      newTopId !== null &&
      topIdRef.current !== newTopId
    ) {
      // Render tamamlanmış olsun diye küçük gecikme — iOS'ta scrollToOffset bazen erken çalışıyor
      requestAnimationFrame(() => {
        recentsListRef.current?.scrollToOffset({ offset: 0, animated: true });
      });
      // Yeni gelen topu kısa süre vurgula (kaydın "düştüğü" net hissedilsin).
      setFlashRollId(newTopId);
    }
    topIdRef.current = newTopId;
  }, [recentRolls]);

  // "✓ Kaydedildi" CTA flaşını ~900ms sonra söndür.
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 900);
    return () => clearTimeout(t);
  }, [justSaved]);

  // Yeni-kayıt vurgusunu ~1.6sn sonra temizle.
  useEffect(() => {
    if (!flashRollId) return;
    const t = setTimeout(() => setFlashRollId(null), 1600);
    return () => clearTimeout(t);
  }, [flashRollId]);

  // ── Mutation ──
  // OFFLINE-AWARE: mutationFn `setMutationDefaults`'ta tanımlı; persist sonrası
  // app restart'ında resolve. Client-üretimi barkod (TEKS-YYYYMMDD-XXXXXXXX)
  // handleSubmit içinde üretilip vars.clientBarcode'a gömülür — backend
  // idempotency anchor (Roll.barcode @unique + P2002 catch → cached Roll).
  // onMutate'te form anında temizlenir + barkod toast'la operatöre gösterilir
  // (sahada fiziksel mal'a not düşmek için). onError'da form geri yüklenir.
  // Etiket basımı onSuccess'te tetiklenir — offline'da paused mutation online
  // dönünce gerçek Roll backend'den geldiğinde LabelPrinter çalışır.
  const createMutation = useMutation<
    Awaited<ReturnType<typeof rollService.createInitialEntry>>,
    Error,
    InitialEntryRequest,
    {
      prevForm: FormState;
      prevManualQty: string;
      prevManualWeight: string;
      clientBarcode: string | undefined;
    } | undefined
  >({
    mutationKey: STATION_MUT.KK1_CREATE_ENTRY,
    onMutate: (vars) => {
      const prevForm = form;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Top kaydedildi',
        text2: onlineManager.isOnline()
          ? `Barkod: ${vars.clientBarcode ?? '...'}`
          : `Çevrimdışı — sync bekliyor · ${vars.clientBarcode ?? ''}`,
      });
      // Oturum sayacı + başarı flaşı (ekran-içi tatmin, offline'da da çalışır).
      setSessionCount((c) => c + 1);
      setJustSaved(true);
      // Form'daki her alan KALICI (ürün, en, kalite) — aynı en'den seri giriş.
      // Yalnızca per-roll manuel değerler (mt/kg) temizlenir.
      const prevManualQty = manualQty;
      const prevManualWeight = manualWeight;
      setManualQty('');
      setManualWeight('');
      return {
        prevForm,
        prevManualQty,
        prevManualWeight,
        clientBarcode: vars.clientBarcode,
      };
    },
    onSuccess: (res) => {
      if (!res.data) return;
      // "Kaydet ve Etiket Bas" — başarılı kayıttan sonra otomatik etiket basımı.
      // Offline'da pause olduysa burası ancak online dönünce çalışır.
      // Queue'ya at: birden fazla mutation sırayla resume olduğunda hepsi basılır
      // (eskiden setPrintRoll overwrite ediyordu, sadece son etiket basıyordu).
      enqueuePrint(res.data);
      qc.invalidateQueries({ queryKey: ['rolls', 'kk1'] });
    },
    onError: (err, _vars, context) => {
      // Form'u + manuel değerleri geri yükle ki operatör veriyi kaybetmesin
      // (özellikle offline'da beklenmedik backend reddi durumunda kritik).
      if (context) {
        setForm(context.prevForm);
        setManualQty(context.prevManualQty);
        setManualWeight(context.prevManualWeight);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: 'error',
        text1: 'Kayıt başarısız',
        text2: err.message,
      });
    },
  });

  // Yanlış giriş / hurda — top SCRAP'a çekilir, open movement'lar kapatılır.
  const scrapMutation = useMutation({
    mutationFn: (id: string) => rollService.scrap(id),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Top iptal edildi',
        text2: res.data?.barcode ?? undefined,
      });
      qc.invalidateQueries({ queryKey: ['rolls', 'kk1'] });
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: 'error',
        text1: 'İptal edilemedi',
        text2: err.message,
      });
    },
  });

  const handleScrapRoll = useCallback(
    (roll: Roll) => {
      if (recentsDrawerOpen || historyOpen) {
        // Modal açıkken: hedefi sıraya al, açık olanı kapat. Kapanma animasyonu
        // bittiğinde (onModalHide) drainPendingScrap çalışıp scrapTarget set eder.
        pendingScrapRef.current = roll;
        setRecentsDrawerOpen(false);
        setHistoryOpen(false);
      } else {
        setScrapTarget(roll);
      }
    },
    [recentsDrawerOpen, historyOpen],
  );

  const drainPendingScrap = useCallback(() => {
    if (pendingScrapRef.current) {
      setScrapTarget(pendingScrapRef.current);
      pendingScrapRef.current = null;
    }
  }, []);

  // Drawer kapanınca (onModalHide) bekleyen niyetleri uygula — scrap onayı veya
  // "Tümünü Gör" → history. İkisi de aynı anda iki-modal çakışmasını önler.
  const handleDrawerClosed = useCallback(() => {
    drainPendingScrap();
    if (pendingHistoryRef.current) {
      pendingHistoryRef.current = false;
      setHistoryOpen(true);
    }
  }, [drainPendingScrap]);

  const confirmScrap = useCallback(() => {
    if (!scrapTarget) return;
    scrapMutation.mutate(scrapTarget.id);
    setScrapTarget(null);
  }, [scrapTarget, scrapMutation]);

  // ── Actions ──
  // En'i tek tuşla temizle — operatör değiştirmek isterse defalarca silmesin.
  const handleClearWidth = useCallback(() => {
    setForm((f) => ({ ...f, width: '' }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    widthRef.current?.focus();
  }, []);

  // Manuel modu aç (metraj info'su uyarı onayından sonra veya doğrudan toggle).
  const openManual = useCallback(() => {
    setManualMode(true);
    setMeterWarnOpen(false);
    requestAnimationFrame(() => manualQtyRef.current?.focus());
  }, []);

  const handleSubmit = async () => {
    if (pulling) return; // makineden okuma sürerken çift tetikleme yok
    if (!form.itemId) {
      Toast.show({ type: 'error', text1: 'Ürün seçimi zorunlu' });
      return;
    }
    const width = Number(form.width);
    if (!width || width <= 0) {
      Toast.show({ type: 'error', text1: 'En (cm) zorunlu' });
      return;
    }
    if (!form.qualityGrade) {
      Toast.show({ type: 'error', text1: 'Kalite sınıfı seçilmedi' });
      return;
    }

    // Metraj (+ağırlık) kaynağı: manuel modda elle, otomatik modda makineden
    // ("Kaydet"e basınca paralel okunur).
    let qty: number;
    let weightKg: number | undefined;
    if (manualMode) {
      qty = Number(manualQty);
      if (!qty || qty <= 0) {
        Toast.show({ type: 'error', text1: 'Manuel metraj (mt) girilmeli' });
        return;
      }
      const w = Number(manualWeight);
      weightKg = w > 0 ? w : undefined;
    } else {
      blurAll();
      setPulling(true);
      try {
        // Otomatik modda yalnız METRAJ makineden okunur. kg sadece manuel modda
        // (opsiyonel) girilir — bu yüzden weightKg burada set EDİLMEZ (undefined).
        qty = await hardwareService.readMeterage();
        setLastMeter(qty);
      } catch {
        Toast.show({
          type: 'error',
          text1: 'Makineden okunamadı',
          text2: 'Manuel moda geçip elle girebilirsiniz.',
        });
        return;
      } finally {
        setPulling(false);
      }
    }

    // Offline-aware: clientBarcode burada üretilir. Mutate paused olursa
    // persist edilen vars sabit kalır → retry'da aynı barkod gönderilir →
    // backend P2002 yakalayıp cached Roll döner (idempotent).
    const clientBarcode = generateClientBarcode();
    createMutation.mutate({
      itemId: form.itemId,
      initialQty: qty,
      width,
      weightKg,
      qualityGrade: form.qualityGrade,
      clientBarcode,
    });
  };

  const handlePrintLabel = (barcode: string) => {
    // Listeden top'u bul ve LabelPrinter'a ver. Operatör başka top için printi
    // tekrar tetikleyene kadar tek print akışı çalışır.
    const roll =
      recentRolls.find((r) => r.barcode === barcode) ??
      historyRollsQuery.data?.data.find((r) => r.barcode === barcode);
    if (!roll) {
      Toast.show({ type: 'error', text1: 'Top bulunamadı', text2: barcode });
      return;
    }
    enqueuePrint(roll);
  };

  // Basılıyor + sırada bekleyen etiket sayısı (offline'da birikebilir).
  const printingCount = (activePrintRoll ? 1 : 0) + printQueue.length;

  return (
    <ScreenChrome
      title="KK1 — Ham Giriş"
      subtitle="Ham kumaş top kayıt"
      headerExtras={
        <View style={styles.headerExtrasRow}>
          {printingCount > 0 && (
            <Animated.View
              entering={FadeInUp.duration(180)}
              exiting={FadeOutUp.duration(140)}
              style={styles.printChip}
            >
              <Pulse color="#fff" size={7} />
              <Text style={styles.printChipText}>{printingCount} etiket</Text>
            </Animated.View>
          )}
          <SyncStatusChip />
          {portraitPhone ? (
            <Appbar.Action
              icon="format-list-bulleted"
              color="#fff"
              onPress={() => setRecentsDrawerOpen(true)}
              accessibilityLabel={`Son kayıtlar (${totalCount})`}
            />
          ) : null}
        </View>
      }
    >
      <View
        style={[
          styles.body,
          // Compact'ta yalnız güvenli-alan (notch) kadar dış boşluk — form
          // neredeyse kenara yaslanır, içerik "ortada emanet" durmaz. İç nefes
          // payı formContentCompact'ta.
          compact && {
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
      >
        {/* ── SOL: Form (kaydırılabilir — küçük ekranda taşmasın) ── */}
        <ScrollView
          style={styles.formCol}
          contentContainerStyle={[
            styles.formContent,
            compact && styles.formContentCompact,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {/* Compact'ta sağ panel yok — sağa kayan drawer aç/kapa tetiği.
              Portrait telefon'da bu tetik header'a taşındı (Appbar.Action). */}
          {compact && !portraitPhone && (
            <View style={styles.drawerTriggerBar}>
              <Button
                mode="contained-tonal"
                icon="format-list-bulleted"
                compact
                onPress={() => setRecentsDrawerOpen(true)}
              >
                Son Kayıtlar · {totalCount}
              </Button>
            </View>
          )}

          {/* ── Manuel giriş paneli (varsayılan KAPALI; makine arızasında elle
              mt/kg). Ürün tarafının en üstünde, açılıp-kapanır. ── */}
          <Surface
            style={[styles.manualBar, manualMode && styles.manualBarActive]}
            elevation={0}
          >
            <TouchableRipple
              borderless
              rippleColor="rgba(217,119,6,0.12)"
              onPress={() => (manualMode ? setManualMode(false) : openManual())}
              style={styles.manualBarTouch}
            >
              <View style={styles.manualBarInner}>
                <Icon source="wrench-outline" size={20} color={colors.warningDark} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.manualBarTitle}>Manuel Giriş</Text>
                  <Text style={styles.manualBarSub}>
                    {manualMode
                      ? 'mt / kg elle giriliyor'
                      : 'Makine arızasında mt / kg elle'}
                  </Text>
                </View>
                <View pointerEvents="none">
                  <Switch value={manualMode} color={colors.warningDark} />
                </View>
              </View>
            </TouchableRipple>
            {manualMode && (
              <Animated.View
                entering={FadeInUp.duration(180)}
                exiting={FadeOutUp.duration(140)}
                style={styles.manualPanel}
              >
                <View style={styles.manualField}>
                  <Text style={styles.manualFieldLabel}>
                    Metraj (mt) <Text style={styles.required}>*</Text>
                  </Text>
                  <NumpadInput
                    ref={manualQtyRef}
                    mode="outlined"
                    value={manualQty}
                    onChangeText={setManualQty}
                    numpadLabel="Metraj (mt)"
                    placeholder="0.0"
                    style={styles.input}
                    contentStyle={styles.manualInputContent}
                    useNativeKeyboard={compact}
                  />
                </View>
                <View style={styles.manualField}>
                  <Text style={styles.manualFieldLabel}>Ağırlık (kg)</Text>
                  <NumpadInput
                    ref={manualWeightRef}
                    mode="outlined"
                    value={manualWeight}
                    onChangeText={setManualWeight}
                    numpadLabel="Ağırlık (kg)"
                    placeholder="0.0"
                    style={styles.input}
                    contentStyle={styles.manualInputContent}
                    useNativeKeyboard={compact}
                  />
                </View>
              </Animated.View>
            )}
          </Surface>

          {/* ── Üretim ayarı: ürün + en + kalite (kaydetler ARASI kalıcı) ── */}
          <Surface style={styles.card} elevation={1}>
            <View style={styles.cardHero}>
              <Icon source="cog-outline" size={18} color={colors.brand} />
              <Text style={styles.cardHeroTitle}>Üretim Ayarı</Text>
              <View style={styles.persistChip}>
                <Icon source="pin" size={11} color={colors.brandDark} />
                <Text style={styles.persistChipText}>kalıcı</Text>
              </View>
            </View>
            <Text style={styles.label}>
              Ürün <Text style={styles.required}>*</Text>
            </Text>
            <TouchableRipple
              borderless
              rippleColor="rgba(79, 70, 229, 0.15)"
              onPressIn={blurAll}
              onPress={() => {
                blurAll();
                setPickerOpen('item');
              }}
              style={styles.picker}
            >
              <View style={styles.pickerInner}>
                <Text
                  style={[styles.pickerText, !form.itemId && styles.pickerPlaceholder]}
                  numberOfLines={1}
                >
                  {form.itemLabel || 'Ürün seçiniz...'}
                </Text>
                <Icon source="chevron-down" size={22} color="#475569" />
              </View>
            </TouchableRipple>

            <Text style={[styles.label, styles.labelSpaced]}>
              En (cm) <Text style={styles.required}>*</Text>
            </Text>
            <View style={styles.widthRow}>
              <NumpadInput
                ref={widthRef}
                mode="outlined"
                value={form.width}
                onChangeText={(v) => setForm((f) => ({ ...f, width: v }))}
                numpadLabel="En (cm)"
                placeholder="örn: 280"
                style={[styles.input, styles.widthInput]}
                contentStyle={styles.widthInputContent}
                useNativeKeyboard={compact}
                autoActivate={!compact}
              />
              <IconButton
                icon="backspace-outline"
                mode="contained-tonal"
                size={24}
                onPress={handleClearWidth}
                disabled={!form.width}
                accessibilityLabel="En'i temizle"
                style={styles.widthClearBtn}
              />
            </View>

            <Text style={[styles.label, styles.labelSpaced]}>Kalite Sınıfı</Text>
            {qualityGradesQuery.isLoading ? (
              <View style={styles.segmentLoading}>
                <ActivityIndicator size="small" color="#4f46e5" />
              </View>
            ) : qualityGrades.length === 0 ? (
              <Text style={styles.segmentEmpty}>
                {qualityGradesQuery.isError
                  ? 'Kalite listesi yüklenemedi'
                  : 'Tanımlı kalite sınıfı yok'}
              </Text>
            ) : (
              <View style={styles.segmentRow}>
                {qualityGrades.map((qg) => (
                  <QualitySegment
                    key={qg.id}
                    grade={qg}
                    selected={form.qualityGrade === qg.code}
                    onPress={handleQualityGradeSelect}
                  />
                ))}
              </View>
            )}
          </Surface>

          {/* ── Metraj info (otomatik mod): salt-okunur. Kaydederken makineden
              okunur; elle override için dokun → uyarı modalı. ── */}
          {!manualMode && (
            <PressableScale
              onPress={() => setMeterWarnOpen(true)}
              rippleColor="rgba(37,99,235,0.10)"
              style={styles.meterInfo}
              accessibilityLabel="Metraj otomatik — elle değiştirmek için dokunun"
            >
              <View style={styles.meterInfoInner}>
                <Icon source="gauge" size={24} color={colors.info} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.meterInfoLabel}>Metraj · otomatik</Text>
                  <Text style={styles.meterInfoValue}>
                    {lastMeter != null
                      ? `Son okunan: ${lastMeter.toFixed(1)} mt`
                      : 'Kaydederken makineden okunur'}
                  </Text>
                </View>
                <Icon source="lock-outline" size={16} color={colors.textMuted} />
              </View>
            </PressableScale>
          )}

          {/* OFFLINE-AWARE: mutation'a disabled binding YOK — paused mutation
              isPending kalsa da sıradaki kayıt engellenmesin. Yalnız `pulling`
              (makineden okuma, ~1sn) sırasında çift-tetiklemeyi kilitleriz. */}
          <Button
            mode="contained"
            icon={pulling ? undefined : justSaved ? 'check-bold' : 'package-check'}
            onPress={handleSubmit}
            loading={pulling}
            disabled={pulling}
            buttonColor={justSaved ? colors.success : undefined}
            style={styles.submitBtn}
            contentStyle={styles.submitBtnContent}
            labelStyle={styles.submitBtnLabel}
          >
            {pulling
              ? 'Makineden okunuyor…'
              : justSaved
                ? 'Kaydedildi ✓'
                : 'Kaydet ve Etiket Bas'}
          </Button>
        </ScrollView>

        {/* ── SAĞ: Üstte son 6 kayıt + altta Numpad ── */}
        {!compact && (
          <View style={styles.recentsCol}>
            <View style={styles.recentsHeader}>
              <View style={{ flex: 1 }}>
                <Text variant="titleMedium" style={styles.recentsTitle}>
                  Son Kayıtlar
                </Text>
                <View style={styles.recentsSubRow}>
                  <Text variant="bodySmall" style={styles.recentsCount}>
                    Toplam {totalCount}
                  </Text>
                  {sessionCount > 0 && (
                    <View style={styles.sessionChip}>
                      <Icon source="check-circle" size={13} color={colors.successDark} />
                      <Text style={styles.sessionChipLabel}>Bu oturum</Text>
                      <AnimatedCounter
                        value={sessionCount}
                        style={styles.sessionChipCount}
                      />
                    </View>
                  )}
                </View>
              </View>
              <Button
                mode="outlined"
                icon="format-list-bulleted"
                compact
                onPress={() => {
                  setHistoryPage(1);
                  setHistoryOpen(true);
                }}
              >
                Tümünü Gör
              </Button>
              <RefreshButton
                onPress={() => recentRollsQuery.refetch()}
                refreshing={recentRollsQuery.isFetching}
                isError={recentRollsQuery.isError}
                errorMessage={(recentRollsQuery.error as Error | undefined)?.message}
              />
            </View>

            <View style={styles.recentsList}>
              {recentRollsQuery.isLoading ? (
                <SkeletonList count={6} />
              ) : recentRollsQuery.isError ? (
                <AnimatedEntrance direction="fade" style={styles.recentsEmpty}>
                  <Text style={styles.recentsEmptyText}>Liste yüklenemedi</Text>
                  <Text style={styles.recentsEmptyHint}>
                    {(recentRollsQuery.error as Error).message}
                  </Text>
                  <Button mode="outlined" onPress={() => recentRollsQuery.refetch()} style={{ marginTop: 12 }}>
                    Tekrar dene
                  </Button>
                </AnimatedEntrance>
              ) : recentRolls.length === 0 ? (
                <AnimatedEntrance direction="fade" style={styles.recentsEmpty}>
                  <Text style={styles.recentsEmptyText}>Henüz kayıt yok</Text>
                  <Text style={styles.recentsEmptyHint}>
                    Kaydedilen toplar burada görünecek
                  </Text>
                </AnimatedEntrance>
              ) : (
                <FlashList
                  ref={recentsListRef}
                  data={recentRolls}
                  keyExtractor={(r) => r.id}
                  extraData={flashRollId}
                  renderItem={({ item }) => (
                    <RollListItem
                      roll={item}
                      isNew={item.id === flashRollId}
                      onPrint={handlePrintLabel}
                      onScrap={handleScrapRoll}
                    />
                  )}
                  contentContainerStyle={styles.recentsListContent}
                  showsVerticalScrollIndicator
                />
              )}
            </View>

            <NumpadHost style={styles.numpadHost} />
          </View>
        )}
      </View>

      {/* Compact modda sağdan kayan son kayıtlar drawer'ı */}
      {compact && (
        <RecentsDrawer
          visible={recentsDrawerOpen}
          onDismiss={() => setRecentsDrawerOpen(false)}
          onClosed={handleDrawerClosed}
          totalCount={totalCount}
          rolls={recentRolls}
          loading={recentRollsQuery.isLoading}
          error={recentRollsQuery.isError ? (recentRollsQuery.error as Error) : null}
          fetching={recentRollsQuery.isFetching}
          onRefresh={() => recentRollsQuery.refetch()}
          onOpenHistory={() => {
            // Drawer kapanış animasyonu bitince history açılır (iki-modal çakışması).
            setHistoryPage(1);
            pendingHistoryRef.current = true;
            setRecentsDrawerOpen(false);
          }}
          onPrint={handlePrintLabel}
          onScrap={handleScrapRoll}
        />
      )}

      {/* ── Tüm kayıtlar modal'ı ── */}
      <RollHistoryModal
        visible={historyOpen}
        onDismiss={() => setHistoryOpen(false)}
        onClosed={drainPendingScrap}
        page={historyPage}
        setPage={setHistoryPage}
        rolls={historyRollsQuery.data?.data ?? []}
        totalPages={historyRollsQuery.data?.pagination.totalPages ?? 1}
        totalCount={historyRollsQuery.data?.pagination.total ?? 0}
        loading={historyRollsQuery.isLoading}
        fetching={historyRollsQuery.isFetching}
        error={historyRollsQuery.isError ? (historyRollsQuery.error as Error) : null}
        onRetry={() => historyRollsQuery.refetch()}
        onPrint={handlePrintLabel}
        onScrap={handleScrapRoll}
      />

      {/* ── Picker Modal'lar ── */}
      <PickerModal
        visible={pickerOpen === 'item'}
        title="Ürün Seç"
        options={itemOptions}
        selectedValue={form.itemId}
        loading={itemsQuery.isLoading}
        onDismiss={() => setPickerOpen(null)}
        onSelect={(value) => {
          const item = itemOptions.find((o) => o.value === value);
          setForm((f) => ({
            ...f,
            itemId: value,
            itemLabel: item ? `${item.label} — ${item.sublabel}` : '',
          }));
        }}
      />

      {/* ── Etiket yazıcı (headless): activePrintRoll set olunca QR + A4 PDF üretir.
            onDone queue'dan bir sonrakini alır. Roll değişimi LabelPrinter'ın
            firedRef'ini reset edebilmesi için 'key' prop'una roll.id veriyoruz —
            her print için fresh mount. */}
      <LabelPrinter
        key={activePrintRoll?.id ?? 'idle'}
        roll={activePrintRoll}
        kind="ROLL_RAW"
        onDone={handlePrintDone}
      />

      {/* ── Scrap onay modal'ı (kendi modalımız; native Alert'i değiştirdi) ── */}
      <ScrapConfirmModal
        roll={scrapTarget}
        loading={scrapMutation.isPending}
        onDismiss={() => setScrapTarget(null)}
        onConfirm={confirmScrap}
      />

      {/* ── Metraj elle-override uyarısı → manuel moda geçiş ── */}
      <ConfirmDialog
        kind="simple"
        visible={meterWarnOpen}
        title="Metrajı elle gir?"
        description="Metraj normalde makineden otomatik okunur. Elle girmek için manuel moda geçilecek — bu yalnızca makine arızasında kullanılmalıdır."
        confirmLabel="Manuel Giriş'e Geç"
        cancelLabel="Vazgeç"
        onConfirm={openManual}
        onDismiss={() => setMeterWarnOpen(false)}
      />
    </ScreenChrome>
  );
}

// ── Son Kayıtlar Drawer (compact / telefon) ──
interface RecentsDrawerProps {
  visible: boolean;
  onDismiss: () => void;
  /** Kapanma animasyonu bittiğinde — RNModal stack çakışmasını çözmek için. */
  onClosed?: () => void;
  totalCount: number;
  rolls: Roll[];
  loading: boolean;
  error: Error | null;
  fetching: boolean;
  onRefresh: () => void;
  onOpenHistory: () => void;
  onPrint: (barcode: string) => void;
  onScrap: (roll: Roll) => void;
}

function RecentsDrawer({
  visible,
  onDismiss,
  onClosed,
  totalCount,
  rolls,
  loading,
  error,
  fetching,
  onRefresh,
  onOpenHistory,
  onPrint,
  onScrap,
}: RecentsDrawerProps) {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Telefon dar; drawer genişliği ekranın %85'i veya max 380px
  const drawerWidth = Math.min(winW * 0.85, 380);

  return (
    <Modal
      isVisible={visible}
      onBackdropPress={onDismiss}
      onBackButtonPress={onDismiss}
      onModalHide={onClosed}
      backdropOpacity={0.4}
      animationIn="slideInRight"
      animationOut="slideOutRight"
      style={drawerStyles.modal}
      useNativeDriver
      hideModalContentWhileAnimating
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
    >
      <View
        style={[
          drawerStyles.sheet,
          {
            width: drawerWidth,
            height: winH,
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 12,
            paddingRight: Math.max(insets.right, 12),
          },
        ]}
      >
        <View style={drawerStyles.header}>
          <View style={{ flex: 1 }}>
            <Text variant="titleLarge" style={drawerStyles.title}>
              Son Kayıtlar
            </Text>
            <Text variant="bodySmall" style={drawerStyles.subtitle}>
              Toplam {totalCount} kayıt
            </Text>
          </View>
          <RefreshButton
            onPress={onRefresh}
            refreshing={fetching}
            isError={!!error}
            errorMessage={error?.message}
          />
          <IconButton icon="close" size={24} onPress={onDismiss} accessibilityLabel="Kapat" />
        </View>

        <View style={drawerStyles.listBox}>
          {loading ? (
            <SkeletonList count={7} />
          ) : error ? (
            <AnimatedEntrance direction="fade" style={drawerStyles.empty}>
              <Text style={drawerStyles.emptyText}>Liste yüklenemedi</Text>
              <Text style={drawerStyles.emptyHint}>{error.message}</Text>
              <Button mode="outlined" onPress={onRefresh} style={{ marginTop: 12 }}>
                Tekrar dene
              </Button>
            </AnimatedEntrance>
          ) : rolls.length === 0 ? (
            <AnimatedEntrance direction="fade" style={drawerStyles.empty}>
              <Text style={drawerStyles.emptyText}>Henüz kayıt yok</Text>
              <Text style={drawerStyles.emptyHint}>
                Kaydedilen toplar burada görünecek
              </Text>
            </AnimatedEntrance>
          ) : (
            <FlashList
              data={rolls}
              keyExtractor={(r) => r.id}
              renderItem={({ item }) => (
                <RollListItem roll={item} onPrint={onPrint} onScrap={onScrap} compactLayout={true} />
              )}
              contentContainerStyle={drawerStyles.listContent}
              showsVerticalScrollIndicator
            />
          )}
        </View>

        <Button
          mode="outlined"
          icon="format-list-bulleted"
          onPress={onOpenHistory}
          style={drawerStyles.historyBtn}
        >
          Tümünü Gör
        </Button>
      </View>
      <Toast config={toastConfig} />
    </Modal>
  );
}

const drawerStyles = StyleSheet.create({
  modal: { margin: 0, padding: 0, justifyContent: 'flex-end', flexDirection: 'row' },
  sheet: {
    backgroundColor: '#fff',
    paddingLeft: 16,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    marginBottom: 8,
  },
  title: { fontWeight: '700', color: '#0f172a' },
  subtitle: { color: '#64748b', marginTop: 2 },
  listBox: { flex: 1, minHeight: 0 },
  listContent: { paddingVertical: 8 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 4 },
  emptyText: { fontSize: 16, color: '#94a3b8', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#cbd5e1' },
  historyBtn: { marginTop: 10 },
});

// ── Tüm Kayıtlar Modal ──
interface RollHistoryModalProps {
  visible: boolean;
  onDismiss: () => void;
  /** Kapanma animasyonu bittiğinde — RNModal stack çakışmasını çözmek için. */
  onClosed?: () => void;
  page: number;
  setPage: (updater: (p: number) => number) => void;
  rolls: Roll[];
  totalPages: number;
  totalCount: number;
  loading: boolean;
  fetching: boolean;
  error: Error | null;
  onRetry: () => void;
  onPrint: (barcode: string) => void;
  onScrap: (roll: Roll) => void;
}

function RollHistoryModal({
  visible,
  onDismiss,
  onClosed,
  page,
  setPage,
  rolls,
  totalPages,
  totalCount,
  loading,
  fetching,
  error,
  onRetry,
  onPrint,
  onScrap,
}: RollHistoryModalProps) {
  const { width: winW, height: winH } = useWindowDimensions();
  const isPhone = useDeviceType() === 'phone';

  return (
    <Modal
      isVisible={visible}
      onBackdropPress={onDismiss}
      onBackButtonPress={onDismiss}
      onModalHide={onClosed}
      backdropOpacity={0.5}
      style={historyStyles.modal}
      useNativeDriver
      hideModalContentWhileAnimating
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
    >
      {/* Telefonda daha geniş + daha kısa (satırlar compact ile alçaldı). */}
      <View
        style={[
          historyStyles.sheet,
          {
            width: winW * (isPhone ? 0.96 : 0.85),
            height: winH * (isPhone ? 0.86 : 0.92),
          },
        ]}
      >
        <View style={historyStyles.header}>
          <View style={{ flex: 1 }}>
            <Text variant="titleLarge" style={historyStyles.title}>
              Tüm KK1 Kayıtları
            </Text>
            <Text variant="bodySmall" style={historyStyles.subtitle}>
              Toplam {totalCount} kayıt · Sayfa {page}/{Math.max(totalPages, 1)}
            </Text>
          </View>
          <IconButton icon="close" size={28} onPress={onDismiss} accessibilityLabel="Kapat" />
        </View>

        <View style={historyStyles.listBox}>
          {loading ? (
            <SkeletonList count={isPhone ? 8 : 10} />
          ) : error ? (
            <View style={historyStyles.empty}>
              <Text style={historyStyles.emptyText}>Liste yüklenemedi</Text>
              <Text style={historyStyles.emptyHint}>{error.message}</Text>
              <Button mode="outlined" onPress={onRetry} style={{ marginTop: 12 }}>
                Tekrar dene
              </Button>
            </View>
          ) : rolls.length === 0 ? (
            <View style={historyStyles.empty}>
              <Text style={historyStyles.emptyText}>Kayıt yok</Text>
            </View>
          ) : (
            <FlashList
              data={rolls}
              keyExtractor={(r) => r.id}
              renderItem={({ item }) => (
                <RollListItem
                  roll={item}
                  onPrint={onPrint}
                  onScrap={onScrap}
                  compactLayout={isPhone}
                />
              )}
            />
          )}
        </View>

        {totalPages > 1 && (
          <View style={historyStyles.pagination}>
            <Button
              mode="outlined"
              icon="chevron-left"
              onPress={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || fetching}
            >
              Önceki
            </Button>
            <Text style={historyStyles.pageInfo}>
              {page} / {totalPages}
            </Text>
            <Button
              mode="outlined"
              icon="chevron-right"
              contentStyle={{ flexDirection: 'row-reverse' }}
              onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || fetching}
            >
              Sonraki
            </Button>
          </View>
        )}
      </View>
      <Toast config={toastConfig} />
    </Modal>
  );
}

const historyStyles = StyleSheet.create({
  modal: { justifyContent: 'center', alignItems: 'center', margin: 0, padding: 0 },
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    marginBottom: 8,
  },
  title: { fontWeight: '700', color: '#0f172a' },
  subtitle: { color: '#64748b', marginTop: 2 },
  listBox: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 4 },
  emptyText: { fontSize: 16, color: '#94a3b8', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#cbd5e1' },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    gap: 12,
  },
  pageInfo: { fontWeight: '600', color: '#334155' },
});

// ── Scrap onay modal'ı ──
// Native Alert telefon yönüyle birlikte dönmüyordu (yan kalıyordu); kendi modal'ımız.
interface ScrapConfirmModalProps {
  roll: Roll | null;
  loading: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}

function ScrapConfirmModal({ roll, loading, onDismiss, onConfirm }: ScrapConfirmModalProps) {
  const { width: winW, height: winH } = useWindowDimensions();
  const sheetWidth = Math.min(winW * 0.9, 460);

  return (
    <Modal
      isVisible={!!roll}
      onBackdropPress={loading ? undefined : onDismiss}
      onBackButtonPress={loading ? undefined : onDismiss}
      backdropOpacity={0.5}
      animationIn="zoomIn"
      animationOut="zoomOut"
      style={scrapStyles.modal}
      useNativeDriver
      hideModalContentWhileAnimating
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
    >
      <View style={[scrapStyles.sheet, { width: sheetWidth }]}>
        <View style={scrapStyles.iconCircle}>
          <Icon source="alert-circle-outline" size={36} color="#dc2626" />
        </View>
        <Text variant="titleLarge" style={scrapStyles.title}>
          Topu iptal et?
        </Text>

        {roll && (
          <View style={scrapStyles.infoBox}>
            <View style={scrapStyles.infoRow}>
              <Text style={scrapStyles.infoLabel}>Barkod</Text>
              <Text style={scrapStyles.infoValue}>{roll.barcode ?? '—'}</Text>
            </View>
            <View style={scrapStyles.infoRow}>
              <Text style={scrapStyles.infoLabel}>Ürün</Text>
              <Text style={scrapStyles.infoValue} numberOfLines={2}>
                {roll.item?.name ?? '—'}
                {roll.color?.name ? ` · ${roll.color.name}` : ''}
              </Text>
            </View>
            <View style={scrapStyles.infoRow}>
              <Text style={scrapStyles.infoLabel}>Metraj</Text>
              <Text style={scrapStyles.infoValue}>
                {roll.initialQty} mt
                {roll.width != null ? ` · ${roll.width} cm` : ''}
              </Text>
            </View>
          </View>
        )}

        <Text style={scrapStyles.hint}>
          Yanlış giriş için kullan. İptal edilen toplar fire sayılmaz, sadece kayıt geri alınır.
        </Text>

        <View style={scrapStyles.actions}>
          <Button
            mode="outlined"
            onPress={onDismiss}
            disabled={loading}
            style={scrapStyles.actionBtn}
            contentStyle={scrapStyles.actionBtnContent}
          >
            Vazgeç
          </Button>
          <Button
            mode="contained"
            buttonColor="#dc2626"
            textColor="#fff"
            icon="trash-can-outline"
            onPress={onConfirm}
            loading={loading}
            disabled={loading}
            style={scrapStyles.actionBtn}
            contentStyle={scrapStyles.actionBtnContent}
          >
            İptal Et
          </Button>
        </View>
      </View>
    </Modal>
  );
}

const scrapStyles = StyleSheet.create({
  modal: { justifyContent: 'center', alignItems: 'center', margin: 0, padding: 0 },
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    alignItems: 'stretch',
    gap: 12,
  },
  iconCircle: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontWeight: '700', color: '#0f172a', textAlign: 'center' },
  infoBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  infoLabel: { width: 70, fontSize: 13, color: '#64748b', fontWeight: '600' },
  infoValue: { flex: 1, fontSize: 14, color: '#0f172a', fontWeight: '600' },
  hint: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
    textAlign: 'center',
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionBtn: { flex: 1, borderRadius: 10 },
  actionBtnContent: { height: 48 },
});

// ── Liste satırı: Roll + kim girdi + ne zaman ──
function RollListItem({
  roll,
  onPrint,
  onScrap,
  compactLayout,
  isNew,
}: {
  roll: Roll;
  onPrint: (b: string) => void;
  onScrap?: (roll: Roll) => void;
  compactLayout?: boolean;
  /** Yeni kaydedilip listeye yeni düşen top — kısa süre vurgulanır. */
  isNew?: boolean;
}) {
  const operator = roll.createdBy?.fullName ?? roll.createdBy?.username ?? 'Bilinmiyor';
  const at = roll.createdAt ? dayjs(roll.createdAt) : null;
  const qty = `${roll.initialQty} mt`;
  const widthLabel = roll.width != null ? `${roll.width} cm` : null;
  const isInactive = roll.status === 'SCRAP';
  const barcode = roll.barcode ?? '—';
  const canPrint = !!roll.barcode;

  return (
    <Surface
      style={[
        styles.recentItem,
        isInactive && styles.recentItemScrapped,
        isNew && !isInactive && styles.recentItemNew,
        compactLayout && { padding: 6, marginVertical: 2, gap: 2 },
      ]}
      elevation={1}
    >
      <View style={[styles.recentItemHeader, compactLayout && { gap: 4 }]}>
        <Text
          style={[
            styles.recentBarcode,
            isInactive && styles.recentBarcodeScrapped,
            compactLayout && { fontSize: 11, paddingVertical: 0 },
          ]}
        >
          {barcode}
        </Text>
        <Text style={[styles.recentTime, compactLayout && { fontSize: 11 }]}>
          {at ? at.format('DD.MM HH:mm') : ''}
        </Text>
        {onScrap && !isInactive && (
          <IconButton
            icon="trash-can-outline"
            mode="contained-tonal"
            size={compactLayout ? 16 : 20}
            containerColor="#fef2f2"
            iconColor="#dc2626"
            onPress={() => onScrap(roll)}
            accessibilityLabel="Topu iptal et / hurda"
            style={[styles.recentScrapBtn, compactLayout && { width: 24, height: 24 }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          />
        )}
        {canPrint && (
          <IconButton
            icon="printer"
            mode="contained-tonal"
            size={compactLayout ? 20 : 35}
            containerColor="#eef2ff"
            iconColor="#000000ff"
            onPress={() => onPrint(roll.barcode!)}
            accessibilityLabel="Etiket bas"
            style={[styles.recentPrintBtn, compactLayout && { width: 28, height: 28 }]}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          />
        )}
      </View>
      <Text
        style={[styles.recentItemName, compactLayout && { fontSize: 11 }]}
        numberOfLines={1}
      >
        {roll.item?.name ?? '—'}
        {roll.color?.name ? ` · ${roll.color.name}` : ''}
      </Text>
      <View style={[styles.recentBottomRow, compactLayout && { marginTop: 2, gap: 6 }]}>
        <View style={styles.recentBadgeRow}>
          <View style={[styles.recentBadge, compactLayout && styles.recentBadgeCompact]}>
            <Icon source="arrow-expand-vertical" size={compactLayout ? 12 : 14} color="#0f172a" />
            <Text style={[styles.recentBadgeText, compactLayout && { fontSize: 11 }]}>{qty}</Text>
          </View>
          {widthLabel && (
            <View style={[styles.recentBadge, compactLayout && styles.recentBadgeCompact]}>
              <Icon source="arrow-expand-horizontal" size={compactLayout ? 12 : 14} color="#0f172a" />
              <Text style={[styles.recentBadgeText, compactLayout && { fontSize: 11 }]}>{widthLabel}</Text>
            </View>
          )}
          {!compactLayout && (
            <View style={styles.recentBadge}>
              <Icon source="star-circle" size={14} color="#0f172a" />
              <Text style={styles.recentBadgeText}>{roll.qualityGrade}</Text>
            </View>
          )}
        </View>

        {compactLayout ? (
          /* "Kalite ile giriş yapan kişi alt alta" — yatayda yer kazanır,
             satır alçalır. */
          <View style={styles.recentQualOp}>
            <View style={[styles.recentBadge, styles.recentBadgeCompact]}>
              <Icon source="star-circle" size={12} color="#0f172a" />
              <Text style={[styles.recentBadgeText, { fontSize: 11 }]}>{roll.qualityGrade}</Text>
            </View>
            <View style={styles.recentOperatorMini}>
              <Icon source="account" size={11} color={colors.brand} />
              <Text style={styles.recentOperatorMiniText} numberOfLines={1}>
                {operator}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.recentOperatorChip}>
            <View style={styles.recentOperatorAvatar}>
              <Icon source="account" size={14} color="#fff" />
            </View>
            <Text style={styles.recentOperatorText} numberOfLines={1}>
              {operator}
            </Text>
          </View>
        )}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, flexDirection: 'row' },
  headerExtrasRow: { flexDirection: 'row', alignItems: 'center' },

  // Sol — Form
  formCol: { flex: 1.4, backgroundColor: '#f8fafc' },
  formContent: { padding: 16, gap: 12, flexGrow: 1, paddingBottom: 16 },
  formContentCompact: { padding: 12, gap: 10, paddingBottom: 14 },
  card: { padding: 14, borderRadius: 12, backgroundColor: '#fff', gap: 4 },

  // ── Manuel giriş paneli (üst, açılır-kapanır; amber = "anormal/dikkat") ──
  manualBar: {
    borderRadius: radius.md,
    backgroundColor: '#fffbeb', // amber 50
    borderWidth: 1,
    borderColor: '#fde68a', // amber 200
    overflow: 'hidden',
  },
  manualBarActive: { borderColor: colors.warningDark },
  manualBarTouch: { borderRadius: radius.md },
  manualBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  manualBarTitle: { fontSize: 15, fontWeight: '700', color: colors.warningDark },
  manualBarSub: { fontSize: 12, color: '#92400e', marginTop: 1 },
  manualPanel: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  manualField: { flex: 1 },
  manualFieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#92400e',
    marginBottom: 4,
  },
  manualInputContent: { fontSize: 24, fontWeight: '700', textAlign: 'center' },

  // ── En satırı + tek-tuş temizleme ──
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  persistHint: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  widthRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  widthInput: { flex: 1 },
  widthInputContent: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  widthClearBtn: { margin: 0 },

  // ── Metraj info readout (otomatik mod, salt-okunur) ──
  meterInfo: {
    borderRadius: radius.md,
    backgroundColor: colors.infoContainer,
    borderWidth: 1,
    borderColor: '#bfdbfe', // blue 200
    overflow: 'hidden',
  },
  meterInfoInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  meterInfoLabel: { fontSize: 13, fontWeight: '700', color: colors.infoDark },
  meterInfoValue: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.infoText,
    marginTop: 1,
  },

  // ── Etiket kuyruğu çipi (header) ──
  printChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.brand,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.md,
    marginRight: spacing.sm,
  },
  printChipText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // ── Üretim ayarı hero header ──
  cardHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  cardHeroTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  persistChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.brandSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  persistChipText: { fontSize: 11, fontWeight: '700', color: colors.brandDark },

  // ── Oturum sayacı çipi (recents header) ──
  recentsSubRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  sessionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.successContainer,
    paddingLeft: 6,
    paddingRight: 9,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  sessionChipLabel: { fontSize: 11, fontWeight: '600', color: colors.successText },
  sessionChipCount: { fontSize: 13, fontWeight: '800', color: colors.successDark },

  // ── Yeni-kayıt vurgusu ──
  recentItemNew: {
    backgroundColor: colors.successContainer,
    borderWidth: 1.5,
    borderColor: colors.success,
  },

  // Compact (telefon) — form üstü sağa yaslı drawer tetiği
  drawerTriggerBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 2,
  },

  label: { fontSize: 14, fontWeight: '600', color: '#334155', marginBottom: 4 },
  labelSpaced: { marginTop: 8 },
  required: { color: '#dc2626' },

  picker: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    overflow: 'hidden',
  },
  pickerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 50,
    paddingHorizontal: 14,
  },
  pickerDisabled: { backgroundColor: '#f1f5f9', opacity: 0.6 },
  pickerText: { fontSize: 16, color: '#0f172a', flex: 1 },
  pickerPlaceholder: { color: '#94a3b8' },

  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-end' },
  rowSpaced: { marginTop: 8 },
  col: { flex: 1 },
  input: { backgroundColor: '#fff' },
  qtyInput: { flex: 1 },
  qtyInputContent: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  pullBtn: { borderColor: '#f59e0b', minWidth: 150 },
  pullBtnContent: { height: 50 },

  segmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  segmentLoading: {
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentEmpty: {
    minHeight: 60,
    textAlign: 'center',
    textAlignVertical: 'center',
    color: '#94a3b8',
    fontSize: 13,
    fontStyle: 'italic',
  },
  segment: {
    flex: 1,
    minHeight: 50,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  segmentSelected: {
    borderColor: '#4f46e5',
    backgroundColor: '#eef2ff',
    borderWidth: 2,
  },
  segmentLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#475569',
    textAlign: 'center',
  },
  segmentLabelSelected: {
    color: '#4f46e5',
  },

  submitBtn: { borderRadius: 12, marginTop: 4 },
  submitBtnContent: { height: 56 },
  submitBtnLabel: { fontSize: 18, fontWeight: '700' },

  // Sağ — Son kayıtlar + Numpad
  recentsCol: {
    flex: 1,
    backgroundColor: '#fff',
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
  },
  recentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  recentsTitle: { fontWeight: '700', color: '#0f172a' },
  recentsCount: { color: '#64748b', marginTop: 2 },
  recentsList: { flex: 1, minHeight: 0 },
  recentsListContent: { padding: 12 },
  recentsEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 4,
  },
  recentsEmptyText: { fontSize: 16, color: '#94a3b8', fontWeight: '600' },
  recentsEmptyHint: { fontSize: 13, color: '#cbd5e1' },

  recentItem: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    marginVertical: 4,
    gap: 4,
  },
  recentItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recentBarcode: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    backgroundColor: '#dcfce7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  recentTime: { fontSize: 12, color: '#0d4a8fff', flex: 1 },
  recentPrintBtn: { margin: 0, width: 35, height: 35 },
  recentScrapBtn: { margin: 0, width: 30, height: 30 },
  recentItemScrapped: { opacity: 0.55, backgroundColor: '#f1f5f9' },
  recentBarcodeScrapped: {
    textDecorationLine: 'line-through',
    color: '#64748b',
    backgroundColor: '#e2e8f0',
  },
  recentItemName: { fontSize: 13, color: '#475569' },
  recentBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  recentBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flexShrink: 1 },
  recentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  recentBadgeText: { fontSize: 12, color: '#0f172a', fontWeight: '600' },
  recentBadgeCompact: { paddingVertical: 1, paddingHorizontal: 4 },
  // Compact: kalite + operatör sağda alt alta (yatayda yer kazanır).
  recentQualOp: { alignItems: 'flex-end', gap: 3, flexShrink: 0, maxWidth: '46%' },
  recentOperatorMini: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  recentOperatorMiniText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
    flexShrink: 1,
  },
  recentOperator: { fontSize: 12, color: '#64748b', marginTop: 2 },
  recentOperatorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#eef2ff',
    paddingLeft: 4,
    paddingRight: 10,
    paddingVertical: 3,
    borderRadius: 999,
    flexShrink: 0,
    maxWidth: '50%',
  },
  recentOperatorAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentOperatorText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3730a3',
    flexShrink: 1,
  },

  // Sabit numpad — sağ sütunun altında
  numpadHost: {
    margin: 12,
    marginTop: 0,
    backgroundColor: '#f8fafc',
  },
});

// Kalite seçim segmenti — React.memo ile form'un başka alanları (qty, width)
// değişirken bu kartlar yeniden render olmasın diye izole.
const QualitySegment = React.memo(function QualitySegment({
  grade,
  selected,
  onPress,
}: {
  grade: QualityGrade;
  selected: boolean;
  onPress: (code: string) => void;
}) {
  const handlePress = useCallback(
    () => onPress(grade.code),
    [onPress, grade.code],
  );
  return (
    <TouchableRipple
      onPress={handlePress}
      borderless
      rippleColor="rgba(79, 70, 229, 0.15)"
      style={[
        styles.segment,
        selected && styles.segmentSelected,
        selected && grade.color
          ? { backgroundColor: grade.color, borderColor: grade.color }
          : null,
      ]}
    >
      <Text
        style={[
          styles.segmentLabel,
          selected && styles.segmentLabelSelected,
          selected && grade.color ? { color: '#fff' } : null,
        ]}
      >
        {grade.name}
      </Text>
    </TouchableRipple>
  );
});

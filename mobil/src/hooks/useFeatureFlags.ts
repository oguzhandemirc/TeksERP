import { useQuery } from '@tanstack/react-query';
import { DEFAULT_FEATURE_FLAGS, featureFlagService } from '../services/featureFlag.service';
import { useAuthStore } from '../store/authStore';

// Feature flag'ler app genelinde tek query — React Query cache'i AsyncStorage'a
// persist edildiği için (App.tsx) son bilinen değer offline'da da uygulanır.
// App.tsx foreground'da bu key'i invalidate eder (admin toggle'ı yansısın).
export const FLAGS_KEY = ['feature-flags'] as const;

export function useFeatureFlags() {
  // Uç auth'lu: token yokken (login ekranı) istek atma — logout sonrası
  // garanti 401 çifti + sahte "Oturum süresi doldu" toast'ı üretiyordu.
  // Cache'teki son değer disabled'ken de okunur (offline davranış korunur).
  const hasToken = useAuthStore((s) => !!s.token);
  return useQuery({
    queryKey: FLAGS_KEY,
    queryFn: featureFlagService.get,
    staleTime: 5 * 60 * 1000,
    enabled: hasToken,
  });
}

/** Üretim modülü açık mı? Default TRUE (backend satır-yok değeri) — yüklenene
 *  kadar üretim ekranları BUGÜNKÜ gibi çizilir. Kapı `useVisibleScreens`tedir. */
export function useProductionEnabled(): boolean {
  return useFeatureFlags().data?.productionEnabled ?? DEFAULT_FEATURE_FLAGS.productionEnabled;
}

/** Dokuma modülü açık mı? Default FALSE (backend satır-yok değeri) — Tezgah kartı
 *  bayrak yüklenene dek çizilmez; kapı `useVisibleScreens`tedir. */
export function useDokumaEnabled(): boolean {
  return useFeatureFlags().data?.dokumaEnabled ?? DEFAULT_FEATURE_FLAGS.dokumaEnabled;
}

/** Devere modülü açık mı? Default FALSE — Levent Sarım kartı bayrak yüklenene dek çizilmez. */
export function useDevereEnabled(): boolean {
  return useFeatureFlags().data?.devereEnabled ?? DEFAULT_FEATURE_FLAGS.devereEnabled;
}

/** Devere Faz 3: tezgah bağı defteri açık mı — devere modülüne BAĞLI (ikisi de açık olmalı). */
export function useDevereMountTracking(): boolean {
  const f = useFeatureFlags().data;
  return (f?.devereEnabled ?? DEFAULT_FEATURE_FLAGS.devereEnabled) && (f?.devereMountTracking ?? DEFAULT_FEATURE_FLAGS.devereMountTracking);
}

/** Emanet (konsinye mülkiyet) modülü açık mı? Default FALSE — KK1 "Sahibi" seçicisi bayrak
 *  yüklenene dek çizilmez (fail-closed: kapalı kurulumda ekran bugünküyle birebir). */
export function useDokumaRunWeavingRequired(): boolean {
  return useFeatureFlags().data?.dokumaRunWeavingOrderRequired ?? DEFAULT_FEATURE_FLAGS.dokumaRunWeavingOrderRequired;
}

export function useDevereBeamWeavingRequired(): boolean {
  return useFeatureFlags().data?.devereBeamWeavingLinkRequired ?? DEFAULT_FEATURE_FLAGS.devereBeamWeavingLinkRequired;
}

export function useEmanetEnabled(): boolean {
  return useFeatureFlags().data?.emanetEnabled ?? DEFAULT_FEATURE_FLAGS.emanetEnabled;
}

/** KK1 ham en girişi açık mı? Yüklenene kadar / hata halinde false (gizli). */
export function useRawWidthEnabled(): boolean {
  return useFeatureFlags().data?.rawWidthEnabled ?? false;
}

/** KK1 manuel girişte ağırlık (kg) alanı açık mı? Default false (gizli).
 *  Backend de ENFORCE eder — kapalıyken gönderilen kg reddedilir. */
export function useKk1WeightEntryEnabled(): boolean {
  return useFeatureFlags().data?.kk1WeightEntryEnabled ?? false;
}

/** KK1 çevrimdışı kuyruksuz (online-only) rejimde mi? Default false (kuyruklu davranış).
 *  Fail-toward-queue bilinçli: bayrak henüz yüklenmemişken kuyruklu (bugünkü) davranış
 *  sürer — yanlış yönde kilitlemektense kayıt almak tercih edilir; RQ cache'i persist
 *  olduğu için son bilinen değer offline açılışta da geçerlidir. */
export function useKk1OnlineOnlyEnabled(): boolean {
  return useFeatureFlags().data?.kk1OnlineOnlyEnabled ?? false;
}

/** KK1 etiket geri-okutma doğrulaması (scan-back) açık mı? Default false —
 *  kapalıyken ekranda hiçbir doğrulama öğesi görünmez. */
export function useKk1LabelScanVerifyEnabled(): boolean {
  return useFeatureFlags().data?.kk1LabelScanVerifyEnabled ?? false;
}

/** KK1 "Tüm Girişler" tüm operatörleri göstersin mi? Default false — bayrak
 *  yüklenemezse DAR kapsama düşülür (yalnız kendi kayıtları): yanlışlıkla
 *  fazla göstermektense az göstermek; operatörün kendi işi her durumda tam. */
export function useKk1HistoryAllEntriesEnabled(): boolean {
  return useFeatureFlags().data?.kk1HistoryAllEntriesEnabled ?? false;
}

/** İade kabulünde personel kaliteyi değiştirebilir mi? Default false (gizli). */
export function useReturnGradingEnabled(): boolean {
  return useFeatureFlags().data?.returnGradingEnabled ?? false;
}

/** Kartela kabulünde cm/kg ölçü alanları gösterilsin mi? Default false (yalnız adet). */
export function useKartelaMeasurementEnabled(): boolean {
  return useFeatureFlags().data?.kartelaMeasurementEnabled ?? false;
}

/** Fason Sevk'te operatör fason talimatını telefondan girebilir mi? Default false (gizli). */
export function useFasonNoteMobileEntry(): boolean {
  return useFeatureFlags().data?.fasonNoteMobileEntry ?? false;
}

/** Sevk için ayrı "ambar aldı / çıkış" onay adımı zorunlu mu? Default false →
 *  ① ekranında "Hemen Sevk Et" kısayolu görünür. Açıkken çıkış yalnız ②'den onaylanır. */
export function useShipmentConfirmationEnabled(): boolean {
  return useFeatureFlags().data?.shipmentConfirmationEnabled ?? false;
}

/** Sevk öncesi TÜM çuvallar tartılı olmalı mı? Default FALSE (yalnız yurtdışı).
 *  FAIL-OPEN: bayrak yüklenemezse sahayı sevk edemez hâle getirmeyiz — kesin
 *  kapı sunucudadır, ekran yalnız uyarıyı ÖNCEDEN gösterir. */
export function useShippingWeighRequiredEnabled(): boolean {
  return useFeatureFlags().data?.shippingWeighRequiredEnabled ?? false;
}

/** Elle kg girişi yetkiyle sınırlı mı? Default FALSE. FAIL-OPEN aynı gerekçe:
 *  istemci yalnız menü satırını gizler, reddi sunucu verir. */
export function useShippingManualWeightRestrictedEnabled(): boolean {
  return useFeatureFlags().data?.shippingManualWeightRestrictedEnabled ?? false;
}

/** Tambur'da çıkan top metresi kayıtlı metreyi aşabilir mi? Default TRUE (açık →
 *  aşımda operatöre onay diyaloğu gösterilir). Admin kapatırsa aşan giriş engellenir. */
export function useTamburOverQuantityEnabled(): boolean {
  return useFeatureFlags().data?.tamburOverQuantityEnabled ?? true;
}

/**
 * Kısa kesim → otomatik A1 FABRİKA ayarı (bayrak + eşik birlikte).
 *
 * Tek hook: ikisi ayrı okunursa bir render'da bayrak yeni, eşik eski olabilir.
 * Cihaz override'ıyla birleştirme `resolveShortCutConfig`te (saf fonksiyon).
 */
export function useTamburShortCutA1(): { enabled: boolean; thresholdM: number | null } {
  const d = useFeatureFlags().data;
  return {
    enabled: d?.tamburShortCutA1Enabled ?? false,
    thresholdM: d?.tamburShortCutA1ThresholdM ?? null,
  };
}

/**
 * FASON KABULÜ — çekme uyarısı ayarı (bayrak + tolerans birlikte).
 *
 * `useTamburShortCutA1` ile aynı gerekçe: ikisi ayrı okunursa bir render'da
 * bayrak yeni, tolerans eski olabilir ve ekran "uyarı var/yok" kararını iki
 * farklı nesille verir.
 */
export function useFasonShrinkWarn(): { enabled: boolean; tolerancePct: number } {
  const d = useFeatureFlags().data;
  return {
    enabled: d?.fasonShrinkWarnEnabled ?? true,
    tolerancePct: d?.fasonShrinkTolerancePct ?? 10,
  };
}

/** Token süresi dolunca otomatik logout açık mı? Default TRUE (yüklenene kadar da açık). */
export function useAutoLogoutOnExpiry(): boolean {
  return useFeatureFlags().data?.autoLogoutOnExpiry ?? true;
}

/** Mobil hareketsizlik kilidi açık mı? Default TRUE. Kapalıysa ASLA kilitlenme. */
export function useMobileIdleLockEnabled(): boolean {
  return useFeatureFlags().data?.mobileIdleLockEnabled ?? true;
}

/** Kaç dakika hareketsizlikte kilit? Default 10 (1..120). */
export function useMobileIdleLockMinutes(): number {
  return useFeatureFlags().data?.mobileIdleLockMinutes ?? 10;
}

/** Uygulama arka plana geçince anında kilitle? Default TRUE. Idle kilitten bağımsız. */
export function useMobileLockOnBackground(): boolean {
  return useFeatureFlags().data?.mobileLockOnBackground ?? true;
}

/** Mobil baskıda raster GW bitmap gönder? Default FALSE (komut yolu). HC-06'da yavaşsa kapalı. */
export function useMobileRasterEnabled(): boolean {
  return useFeatureFlags().data?.mobileRasterEnabled ?? false;
}

/**
 * Fire ("etiketsiz" işaretli) kalitede de OTOMATİK etiket basılsın mı?
 * Default FALSE — bayrak yüklenemese de kapalı kabul edilir, yani fire topa
 * kâğıt çıkmaz. Bu fail-closed yön BİLİNÇLİ: fazladan basılan fire etiketi
 * sahaya yanlış "satılabilir" sinyali bırakır, basılmayan etiket ise yalnız
 * operatörün bir kez daha dokunmasını gerektirir (elle baskı hep açık).
 */
export function useScrapGradeLabelEnabled(): boolean {
  return useFeatureFlags().data?.scrapGradeLabelEnabled ?? false;
}

/** Kurşun bypass düzeni (istasyona tablet konulmayan model) açık mı? Default FALSE
 *  (yüklenene kadar / hata halinde de false — fail-closed).
 *  ⚠️ 2026-08-05: "Kurşun Dağıtım" ekranının GÖRÜNÜRLÜĞÜNÜ artık HİÇ etkilemez —
 *  ekran yalnız `mobile:kursun-dagitim` iznine bağlı (bkz. useVisibleScreens).
 *  Bayrak iki şeyi söyler: yeni atama yapılabilir mi, ve kurşun TABLETİ salt-okunur
 *  mu (ikincisini backend `StepSummary.tabletReadOnly` ile adım adım bildirir). */
export function useKursunBypassEnabled(): boolean {
  return useFeatureFlags().data?.kursunBypassEnabled ?? false;
}

/** Müşteri şubeleri (sevk noktaları) kullanılıyor mu? Default TRUE — Electron ile
 *  AYNI varsayılan (`useCustomerBranchesEnabled`). Kapalı fabrikada sipariş formu
 *  şubeyi HİÇ SORMAZ (alan gizlenir, payload'a `branchId` konmaz). Fail-OPEN
 *  bilinçli: yüklenememiş bayrak yüzünden şube sormayı bırakırsak, şube kullanan
 *  fabrikada sipariş sessizce şubesiz açılır ve sevk hedefi kaybolur. */
export function useCustomerBranchesEnabled(): boolean {
  return useFeatureFlags().data?.customerBranchesEnabled ?? true;
}

/** Paketleme grubu (çalışma yaftası) açık mı? Default FALSE = bugünkü davranış
 *  (düz liste, "Hemen Sevk Et" havuzun tamamını gönderir). Fail-closed: bayrak
 *  yüklenemediyse grup şeridi çizilmez ve grup ucu hiç çağrılmaz. */
export function usePackingGroupsEnabled(): boolean {
  return useFeatureFlags().data?.packingGroupsEnabled ?? false;
}

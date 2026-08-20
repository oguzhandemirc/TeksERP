import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import {
  type CompanyLetterhead,
  type DocumentsConfig,
  DEFAULT_COMPANY_LETTERHEAD,
} from './documentConfig';

// =============================================================================
// Public feature flag'ler — backend: GET /api/feature-flags (auth-only, özel
// permission yok). App açılışında 1 kez çekilip React Query cache'inde tutulur;
// UI bu flag'lere göre alan gösterir/gizler. Backend ENFORCE ETMEZ (sadece UI
// rehberi). Admin Electron yönetim panelinden toggle eder.
// =============================================================================

/** Sevk irsaliyesi künyesinde firma adı verilmediğinde varsayılan. */
export const DEFAULT_COMPANY_NAME = 'Adnan Şahin Tekstil';

export interface FeatureFlags {
  pricingEnabled: boolean;
  targetQuantityEnabled: boolean;
  /** KK1 ham kumaş girişinde "en (cm)" alanı gösterilsin mi (default false). */
  rawWidthEnabled: boolean;
  /** KK1 ham kumaş girişinde "ağırlık (kg)" alanı gösterilsin mi (default false).
   *  Backend ENFORCE eder — kapalıyken gönderilen weightKg reddedilir. */
  kk1WeightEntryEnabled: boolean;
  /** KK1 ham giriş çevrimdışı kuyruksuz (online-only) rejimde mi (default false).
   *  Açıkken KK1 çevrimdışıyken kayıt ALMAZ (form kilitli + sebep bandı) ve
   *  kayıt asla offline kuyruğa düşmez — kayıt+etiket tek nefeste yürür.
   *  ENFORCE bu istemcidedir (kuyruk istemci kavramı). */
  kk1OnlineOnlyEnabled: boolean;
  /** KK1 etiket geri-okutma doğrulaması (scan-back, default false). Açıkken
   *  basılan her etiket için okutma istenir ve okutulmadan yeni top girilemez.
   *  ENFORCE bu istemcidedir; kapalıyken ekranda hiçbir iz yok. */
  kk1LabelScanVerifyEnabled: boolean;
  /** KK1 "Tüm Girişler" TÜM operatörlerin kayıtlarını göstersin mi (default
   *  false). Kapalıyken liste yalnız oturumdaki operatörün kendi girdiği
   *  toplar; sağdaki "Son Kayıtlar" bayraktan bağımsız HER ZAMAN kişiye özel.
   *  ENFORCE bu istemcidedir (createdById filtresini istemci gönderir) —
   *  yetki duvarı değil ekran sadeleştirmesi. */
  kk1HistoryAllEntriesEnabled: boolean;
  /** Simüle kantardan gelen çuval tartısı kaydedilebilsin mi (default false).
   *  Backend ENFORCE eder — kapalıyken SIMULATED beyanlı tartı 400 döner. Elle
   *  giriş (MANUAL) muaftır. Yalnız demo/eğitim kurulumu açar. */
  shippingSimulatedWeightEnabled: boolean;
  /** İade kabulünde personel kaliteyi değiştirebilsin mi (default false). */
  returnGradingEnabled: boolean;
  /** Kartela kabulünde cm/kg ölçü alanları gösterilsin mi (default false → yalnız adet). */
  kartelaMeasurementEnabled: boolean;
  /** Fason Sevk'te fason talimatını operatör telefondan girebilsin mi (default false). */
  fasonNoteMobileEntry: boolean;
  /** Sevk için ayrı "ambar aldı / çıkış" onay adımı zorunlu mu (default false). Kapalıyken
   *  ① Sevkiyat ekranında "Hemen Sevk Et" kısayolu görünür; açıkken çıkış yalnız ② "Sevk Çıkışı"
   *  ekranından onaylanır. Ara depoda bekleme + sonradan çıkış flag'den bağımsız her zaman var. */
  shipmentConfirmationEnabled: boolean;
  /** Tambur'da çıkan top metresi kayıtlı (giriş) metreyi aşabilsin mi (default TRUE/açık).
   *  Açıkken operatör kayıtlıdan fazla ölçtüğünde onay diyaloğu sonrası kabul edilir;
   *  backend ENFORCE eder (admin kapatırsa aşan giriş 400 döner). */
  tamburOverQuantityEnabled: boolean;
  /** KISA KESİM → OTOMATİK A1 fabrika varsayılanı (default FALSE/kapalı).
   *  Kural İSTEMCİDE koşar (`shortCutQuality.ts`) — backend enforce etmez; bu
   *  bayrak yalnız "fabrika ne diyor" sorusunun cevabıdır. Yetkili operatör
   *  cihaz bazında ezebilir (`deviceSettingsStore.tamburShortCutA1Override`). */
  tamburShortCutA1Enabled: boolean;
  /** Kısa kesim eşiği (metre); null = girilmemiş → bayrak açık olsa da kural
   *  ateşlemez. Sayısal ayarın mobil sözleşmede emsali `mobileIdleLockMinutes`. */
  tamburShortCutA1ThresholdM: number | null;
  /** ERP'nin kurulduğu firmanın adı — sevk irsaliyesi künyesinde basılır. */
  companyName: string;
  /** Belge künyesi (adres/tel/vergi) — irsaliye üst bloğunda basılır. */
  companyLetterhead: CompanyLetterhead;
  /** Yazdırılan belge içerik ayarı (canlı). resolveDocConfig ile çözülür. */
  documentsConfig: DocumentsConfig;
  /** Token süresi dolunca cihaz otomatik logout etsin mi (default true, client enforce). */
  autoLogoutOnExpiry: boolean;
  /** Mobil hareketsizlik kilidi açık mı (default true). Kapalıysa ASLA kilitlenmez. */
  mobileIdleLockEnabled: boolean;
  /** Kaç dakika hareketsizlikte kilit ekranı (1..120, default 10). */
  mobileIdleLockMinutes: number;
  /** Uygulama arka plana geçince (operatör çıkınca) anında kilitlensin mi (default true).
   *  Idle kilitten bağımsız — kapalıysa arka plana geçince kilitlenmez. */
  mobileLockOnBackground: boolean;
  /** Mobil (HC-06/BT) baskıda raster GW bitmap gönderilsin mi (default false → komut yolu).
   *  Açıkken WYSIWYG ama ~40KB binary HC-06'dan gider; sahada yavaşsa admin kapatır. */
  mobileRasterEnabled: boolean;
  /** Fire ("etiketsiz" işaretli — QualityGrade.skipLabel) kalitede de OTOMATİK
   *  etiket basılsın mı (default false → fire topa kâğıt çıkmaz). Elle "Etiket"
   *  baskısı kapatılmaz, onay sorulur. Client (mobil) ENFORCE. */
  scrapGradeLabelEnabled: boolean;
  /** Kurşun bypass düzeni (istasyona tablet konulmayan model) açık mı (default false).
   *  Backend ENFORCE eder ama YALNIZ yeni atama oluşturmayı kapılar — dağıtılmış iş
   *  emirleri bayrak kapansa da bypass rejiminde biter (rejim atama satırında kalıcı).
   *  2026-08-05: mobilde "Kurşun Dağıtım" ekranının GÖRÜNÜRLÜĞÜNÜ etkilemez —
   *  ekran yalnız izne bağlı (bkz. hooks/useVisibleScreens). Bayrak ayrıca kurşun
   *  TABLETİNİ salt-okunur yapar; kararı adım adım backend bildirir
   *  (`KursunStepSummary.tabletReadOnly`). */
  kursunBypassEnabled: boolean;
  /** Müşteri şubeleri (sevk noktaları) kullanılıyor mu (default TRUE). Kapalıysa
   *  sipariş formu şube alanını hiç göstermez. Yalnız UI rehberi — backend
   *  `branchId` gönderilirse yine doğrular. */
  customerBranchesEnabled: boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  pricingEnabled: false,
  targetQuantityEnabled: false,
  rawWidthEnabled: false,
  kk1WeightEntryEnabled: false,
  kk1HistoryAllEntriesEnabled: false,
  // Varsayılan KAPALI (kuyruklu davranış) — fail-toward-queue: bayrak
  // yüklenemezse yanlış yönde kilitlemektense kayıt almak tercih edilir.
  kk1OnlineOnlyEnabled: false,
  // Varsayılan KAPALI — bayrak yüklenemezken okutma zorunluluğu dayatılmaz
  // (fail-open: doğrulama ek güvencedir, yokluğu akışı durdurmamalı).
  kk1LabelScanVerifyEnabled: false,
  shippingSimulatedWeightEnabled: false,
  returnGradingEnabled: false,
  kartelaMeasurementEnabled: false,
  fasonNoteMobileEntry: false,
  shipmentConfirmationEnabled: false,
  // Default AÇIK (backend ile aynı) — yüklenene/offline'da da aşıma izin var.
  tamburOverQuantityEnabled: true,
  // FAIL-SAFE: bayrak yüklenemezse kural KAPALI — kaliteyi kendiliğinden
  // değiştiren bir otomasyon "belki açıktır" varsayımıyla çalışmaz.
  tamburShortCutA1Enabled: false,
  tamburShortCutA1ThresholdM: null,
  companyName: DEFAULT_COMPANY_NAME,
  companyLetterhead: DEFAULT_COMPANY_LETTERHEAD,
  documentsConfig: {},
  autoLogoutOnExpiry: true,
  mobileIdleLockEnabled: true,
  mobileIdleLockMinutes: 10,
  mobileLockOnBackground: true,
  mobileRasterEnabled: false,
  // Fail-closed yön: bayrak okunamazsa da fire topa etiket BASILMAZ.
  scrapGradeLabelEnabled: false,
  kursunBypassEnabled: false,
  // Backend/Electron ile aynı yön: şube kullanımı varsayılan AÇIK.
  customerBranchesEnabled: true,
};

export const featureFlagService = {
  get: (): Promise<FeatureFlags> =>
    apiClient
      .get<ApiResponse<FeatureFlags>>('/feature-flags')
      .then((r) => r.data.data ?? DEFAULT_FEATURE_FLAGS),
};

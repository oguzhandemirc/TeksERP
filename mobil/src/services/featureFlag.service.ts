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
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  pricingEnabled: false,
  targetQuantityEnabled: false,
  rawWidthEnabled: false,
  kk1WeightEntryEnabled: false,
  returnGradingEnabled: false,
  kartelaMeasurementEnabled: false,
  fasonNoteMobileEntry: false,
  shipmentConfirmationEnabled: false,
  // Default AÇIK (backend ile aynı) — yüklenene/offline'da da aşıma izin var.
  tamburOverQuantityEnabled: true,
  companyName: DEFAULT_COMPANY_NAME,
  companyLetterhead: DEFAULT_COMPANY_LETTERHEAD,
  documentsConfig: {},
  autoLogoutOnExpiry: true,
  mobileIdleLockEnabled: true,
  mobileIdleLockMinutes: 10,
  mobileLockOnBackground: true,
  mobileRasterEnabled: false,
};

export const featureFlagService = {
  get: (): Promise<FeatureFlags> =>
    apiClient
      .get<ApiResponse<FeatureFlags>>('/feature-flags')
      .then((r) => r.data.data ?? DEFAULT_FEATURE_FLAGS),
};

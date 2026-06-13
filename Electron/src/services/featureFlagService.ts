import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import {
  type CompanyLetterhead,
  type DocumentsConfig,
  DEFAULT_COMPANY_LETTERHEAD,
} from "./documentConfig";

export type { CompanyLetterhead, DocumentsConfig } from "./documentConfig";

/** Refakat kartı marka/içerik ayarı — kart basımında snapshot'a dondurulur. */
export interface TravelerCardConfig {
  companyName: string;
  /** Firma adının altına basılan adres (boş → basılmaz). */
  addressLine: string;
  /** Firma adının altına basılan telefon (boş → basılmaz). */
  phone: string;
  showOperationGrid: boolean;
  showNotes: boolean;
  showOrders: boolean;
  /** Özellikler (ÖZELLİKLER) satırı basılsın mı. */
  showProperties: boolean;
  /** Kart altına basılan serbest not (boş → basılmaz). */
  footerNote: string;
}

export const DEFAULT_TRAVELER_CARD_CONFIG: TravelerCardConfig = {
  companyName: "Adnan Şahin Tekstil",
  addressLine: "",
  phone: "",
  showOperationGrid: true,
  showNotes: true,
  showOrders: true,
  showProperties: true,
  footerNote: "",
};

/** Firma adı verilmediğinde gösterilen varsayılan (backend ile aynı). */
export const DEFAULT_COMPANY_NAME = "Adnan Şahin Tekstil";

export interface FeatureFlags {
  /** ERP'nin kurulduğu firmanın adı — panel başlığı + uygulama geneli. */
  companyName: string;
  pricingEnabled: boolean;
  targetQuantityEnabled: boolean;
  rawWidthEnabled: boolean;
  returnGradingEnabled: boolean;
  /** İş emri parti kodu otomatik mi üretilsin (true) manuel mi girilsin (false=default). */
  partyCodeAuto: boolean;
  /** Fason Sevk boyahane notunu sahadaki operatör telefondan girebilsin mi (false=default). */
  dyehouseNoteMobileEntry: boolean;
  /** Mobil cihaz eşleştirmesi zorunlu mu (true=aktif) yoksa pasif mi (false=default).
   *  Pasifken eşleşmemiş tabletler de sisteme girer (makine atfı NULL kalır). ENFORCE edilir. */
  devicePairingRequired: boolean;
  /** Sevk için ayrı "ambar aldı / çıkış" onay adımı zorunlu mu (false=default). Kapalıyken
   *  mobil ① Sevkiyat ekranında "Hemen Sevk Et" kısayolu görünür; açıkken çıkış yalnız ②
   *  "Sevk Çıkışı" ekranından onaylanır. Ara depoda bekleme her iki modda da mümkündür. */
  shipmentConfirmationEnabled: boolean;
  /** Tambur'da çıkan top metresi kayıtlı (giriş) metreyi aşabilsin mi (true=default/açık).
   *  Açıkken operatör kayıtlıdan fazla ölçtüğünde (örn. 100m açık kumaşı 150m top yapma)
   *  onay sonrası kabul edilir; kaynak top tamamen tüketilir. Backend ENFORCE eder. */
  tamburOverQuantityEnabled: boolean;
  /** Oturum (JWT) ömrü — saat (default 8). Giriş sonrası token kaç saat geçerli kalır;
   *  süre dolunca (aktif kullanırken bile) yeniden giriş gerekir. Backend ENFORCE eder
   *  (yalnız sonraki girişlere uygulanır; mevcut açık oturumlar süreleriyle devam eder). */
  sessionDurationHours: number;
  /** Hareketsizlik zaman aşımı — dakika (default 0 = kapalı). >0 iken panel bu kadar
   *  dakika hiç işlem (fare/klavye) görmezse otomatik çıkış yapar. Frontend ENFORCE eder. */
  idleTimeoutMinutes: number;
  /** Saha #6: top etiketi kopya adedi (default 2 — topun üstüne + altına). 1-5. */
  labelCopies: number;
  /** Saha #20: top adı format şablonu ({item} {color} {width} {quality}). */
  rollNameTemplate: string;
  /** Refakat kartı marka/içerik ayarı (firma adı + bölüm görünürlükleri). */
  travelerCardConfig: TravelerCardConfig;
  /** Belge künyesi (adres/tel/vergi) — irsaliye/çeki üst bloğunda basılır. */
  companyLetterhead: CompanyLetterhead;
  /** Yazdırılan belgelerin içerik ayarı (canlı). resolveDocConfig ile çözülür. */
  documentsConfig: DocumentsConfig;
}

export { DEFAULT_COMPANY_LETTERHEAD };

export const featureFlagService = {
  get: (): Promise<ApiResponse<FeatureFlags>> =>
    apiClient.get<ApiResponse<FeatureFlags>>("/api/feature-flags").then((r) => r.data),

  update: (flags: Partial<FeatureFlags>): Promise<ApiResponse<FeatureFlags>> =>
    apiClient
      .patch<ApiResponse<FeatureFlags>>("/api/feature-flags", flags)
      .then((r) => r.data),
};

export interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
}

export const currencyService = {
  list: (): Promise<ApiResponse<CurrencyOption[]>> =>
    apiClient.get<ApiResponse<CurrencyOption[]>>("/api/currencies").then((r) => r.data),
};

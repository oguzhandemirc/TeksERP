import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import {
  type CompanyLetterhead,
  type DocumentsConfig,
  DEFAULT_COMPANY_LETTERHEAD,
} from "./documentConfig";

export type { CompanyLetterhead, DocumentsConfig } from "./documentConfig";

export type TravelerCardPageSize = "A4" | "A5";
export type TravelerCardFontWeight = "light" | "normal" | "bold";
export interface TravelerCardMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export type TravelerCardFieldSize = "sm" | "md" | "lg";
/** Tek spec alanı — göster + boyut + kalınlık (alan-başına bağımsız). */
export interface TravelerCardSpecField {
  show: boolean;
  size: TravelerCardFieldSize;
  weight: TravelerCardFontWeight;
}
/** Spec grid alanları — her biri tek tek (göster/boyut/kalınlık). */
export interface TravelerCardSpecFields {
  color: TravelerCardSpecField;
  width: TravelerCardSpecField;
  targetQuantity: TravelerCardSpecField;
  targetWeight: TravelerCardSpecField;
  foldType: TravelerCardSpecField;
  startDate: TravelerCardSpecField;
  endDate: TravelerCardSpecField;
}
/** Bağlı siparişler tablosu sütunları — her biri tek tek. */
export interface TravelerCardOrderFields {
  orderNumber: TravelerCardSpecField;
  customer: TravelerCardSpecField;
  item: TravelerCardSpecField;
  color: TravelerCardSpecField;
  quantity: TravelerCardSpecField;
}

/** Refakat kartı marka/içerik ayarı — kart basımında snapshot'a dondurulur. */
export interface TravelerCardConfig {
  companyName: string;
  /** Firma adının altına basılan adres (boş → basılmaz). */
  addressLine: string;
  /** Firma adının altına basılan telefon (boş → basılmaz). */
  phone: string;
  /** Sayfa boyutu — A4 (standart) veya A5. */
  pageSize: TravelerCardPageSize;
  /** Kenar boşlukları (mm) — hangi kenardan ne kadar pay. */
  margins: TravelerCardMargins;
  /** Yazı boyutu ölçeği — tüm yazılar bununla çarpılır (0.7–1.4). */
  fontScale: number;
  /** Yazı kalınlığı — ince/normal/kalın. */
  fontWeight: TravelerCardFontWeight;
  showOperationGrid: boolean;
  showNotes: boolean;
  showOrders: boolean;
  /** Özellikler (ÖZELLİKLER) satırı basılsın mı. */
  showProperties: boolean;
  /** Spec grid alan görünürlükleri (Renk/En/Hedef Metraj/...). */
  specFields: TravelerCardSpecFields;
  /** Spec grid'de satır başına sütun sayısı (1–4). */
  specColumns: number;
  /** Bağlı siparişler tablosu sütunları (Sipariş No/Müşteri/Ürün/Renk/Miktar). */
  orderFields: TravelerCardOrderFields;
  /** Miktar toplamı satırı — göster/boyut/kalınlık (show=false → basılmaz). */
  orderTotal: TravelerCardSpecField;
  /** Kart altına basılan serbest not (boş → basılmaz). */
  footerNote: string;
}

export const DEFAULT_TRAVELER_CARD_CONFIG: TravelerCardConfig = {
  companyName: "Adnan Şahin Tekstil",
  addressLine: "",
  phone: "",
  pageSize: "A4",
  margins: { top: 8, right: 8, bottom: 8, left: 8 },
  fontScale: 1,
  fontWeight: "normal",
  showOperationGrid: true,
  showNotes: true,
  showOrders: true,
  showProperties: true,
  specFields: {
    color: { show: true, size: "md", weight: "normal" },
    width: { show: true, size: "md", weight: "normal" },
    targetQuantity: { show: true, size: "md", weight: "normal" },
    targetWeight: { show: true, size: "md", weight: "normal" },
    foldType: { show: true, size: "md", weight: "normal" },
    startDate: { show: true, size: "md", weight: "normal" },
    endDate: { show: true, size: "md", weight: "normal" },
  },
  specColumns: 3,
  orderFields: {
    orderNumber: { show: true, size: "md", weight: "normal" },
    customer: { show: true, size: "md", weight: "normal" },
    item: { show: true, size: "md", weight: "normal" },
    color: { show: true, size: "md", weight: "normal" },
    quantity: { show: true, size: "md", weight: "normal" },
  },
  orderTotal: { show: true, size: "md", weight: "bold" },
  footerNote: "",
};

/** Firma adı verilmediğinde gösterilen varsayılan (backend ile aynı). */
export const DEFAULT_COMPANY_NAME = "Adnan Şahin Tekstil";

/** Etiket yazıcı dili (backend PrinterLanguage enum ile aynı). */
export type PrinterLanguage = "RASTER_HTML" | "PPLA" | "PPLB" | "ZPL";
export const DEFAULT_PRINTER_LANGUAGE: PrinterLanguage = "PPLA";
export const PRINTER_LANGUAGE_LABELS: Record<PrinterLanguage, string> = {
  RASTER_HTML: "HTML (OS yazıcı sürücüsü)",
  PPLA: "Argox PPLA",
  PPLB: "PPLB (EPL2)",
  ZPL: "Zebra ZPL",
};

export interface FeatureFlags {
  /** ERP'nin kurulduğu firmanın adı — panel başlığı + uygulama geneli. */
  companyName: string;
  pricingEnabled: boolean;
  targetQuantityEnabled: boolean;
  rawWidthEnabled: boolean;
  returnGradingEnabled: boolean;
  /** Kartela kabulünde cm/kg ölçü alanları + listelerde ölçü gösterimi (false=default, yalnız adet). */
  kartelaMeasurementEnabled: boolean;
  /** İş emri parti kodu otomatik mi üretilsin (true) manuel mi girilsin (false=default). */
  partyCodeAuto: boolean;
  /** Fason Sevk talimatını sahadaki operatör telefondan girebilsin mi (false=default). */
  fasonNoteMobileEntry: boolean;
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
  /** Çalışma oturumu (saha — kim hangi makinede) idle zaman aşımı — dakika (default 600
   *  = 10 saat; 0 = kapalı). Backend TEMBEL enforce: süre dolan oturum okuma anında IDLE
   *  kapanır; operatör bir sonraki işlemde yeniden yer onayı verir. */
  workSessionIdleTimeoutMinutes: number;
  /** Saha #6: top etiketi kopya adedi (default 2 — topun üstüne + altına). 1-5. */
  labelCopies: number;
  /** Saha #20: top adı format şablonu ({item} {color} {width} {quality}). */
  rollNameTemplate: string;
  /** Varsayılan etiket yazıcı dili (RASTER_HTML | PPLA | PPLB | ZPL; default PPLA).
   *  Native render bu dilde; istasyon yazıcı modeli kendi dilini belirtirse o önceliklidir. */
  printerLanguage: PrinterLanguage;
  /** Faz-2 opt-in: native komutları yazıcıya doğrudan (RAW TCP 9100) gönder (default false). */
  nativeSendEnabled: boolean;
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

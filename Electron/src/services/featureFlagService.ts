import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { SameTypeSessionPolicy } from "@/types/auth";
import {
  type CompanyLetterhead,
  type DocumentsConfig,
  DEFAULT_COMPANY_LETTERHEAD,
} from "./documentConfig";

export type { CompanyLetterhead, DocumentsConfig } from "./documentConfig";

/** Mobil giriş yöntemleri (auth.loginMethods). */
export type LoginMethod = "list" | "pin" | "card";

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
export const PRINTER_LANGUAGE_LABELS: Record<PrinterLanguage, string> = {
  RASTER_HTML: "HTML (OS yazıcı sürücüsü)",
  PPLA: "PPLA (Argox/Datamax)",
  PPLB: "PPLB (Eltron/EPL)",
  ZPL: "ZPL (Zebra uyumlu)",
};

/** Sistem varsayılan etiket medyası (cihazsız baskı/önizleme fallback'i). */
export interface DefaultLabelMedia {
  widthMm: number;
  heightMm: number;
  dpi: number;
  gapMm: number;
  marginMm: number;
}

export interface FeatureFlags {
  /** ERP'nin kurulduğu firmanın adı — panel başlığı + uygulama geneli. */
  companyName: string;
  pricingEnabled: boolean;
  targetQuantityEnabled: boolean;
  rawWidthEnabled: boolean;
  /** KK1 ham kumaş girişinde ağırlık (kg) alanı — default false; backend ENFORCE eder. */
  kk1WeightEntryEnabled: boolean;
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
  /** Sevk onayı adımı zorunlu mu (false=default). Kapalıyken çuvallar seçilir seçilmez
   *  DOĞRUDAN sevk edilir (createShipment → DISPATCHED, stok o an düşer); açıkken önce
   *  PLANNED sevkiyat kurulur, çıkış ayrıca "Sevk Kapısı" ekranından onaylanır. */
  shipmentConfirmationEnabled: boolean;
  /** Tambur'da çıkan top metresi kayıtlı (giriş) metreyi aşabilsin mi (true=default/açık).
   *  Açıkken operatör kayıtlıdan fazla ölçtüğünde (örn. 100m açık kumaşı 150m top yapma)
   *  onay sonrası kabul edilir; kaynak top tamamen tüketilir. Backend ENFORCE eder. */
  tamburOverQuantityEnabled: boolean;
  /** Oturum (JWT) ömrü — DAKİKA (default 480 = 8 saat; 1..43200 = 30 gün). Giriş
   *  sonrası token kaç dakika geçerli kalır; süre dolunca (aktif kullanırken bile)
   *  yeniden giriş gerekir. Backend ENFORCE eder (yalnız sonraki girişlere uygulanır;
   *  mevcut açık oturumlar süreleriyle devam eder). Tek kaynak budur. */
  sessionDurationMinutes: number;
  /** Geriye uyum: oturum ömrü — saat. Backend `sessionDurationMinutes`'ten türetir
   *  (Math.max(1, round(dk/60))). Yeni yazımlarda `sessionDurationMinutes` gönderilir. */
  sessionDurationHours: number;
  /** Hareketsizlik zaman aşımı — dakika (default 0 = kapalı). >0 iken panel bu kadar
   *  dakika hiç işlem (fare/klavye) görmezse otomatik çıkış yapar. Frontend ENFORCE eder. */
  idleTimeoutMinutes: number;
  /** Çalışma oturumu (saha — kim hangi makinede) idle zaman aşımı — dakika (default 20;
   *  0 = kapalı). Backend TEMBEL enforce: süre dolan oturum okuma anında IDLE kapanır;
   *  operatör bir sonraki işlemde yeniden yer onayı verir. */
  workSessionIdleTimeoutMinutes: number;
  /** Token süresi dolunca istemci otomatik çıkış yapsın mı (default true; mobil+electron).
   *  Client ENFORCE: JWT exp'e göre zamanlayıcı kurulur, süre dolunca oturum kapanır. */
  autoLogoutOnExpiry: boolean;
  /** Mobil hareketsizlik kilidi açık mı (default true). Client ENFORCE (yalnız mobil):
   *  tablet bu kadar dakika kullanılmazsa kilit ekranı; work session açık kalır. */
  mobileIdleLockEnabled: boolean;
  /** Mobil hareketsizlik kilidi süresi — dakika (1..120, default 10). Client ENFORCE (mobil). */
  mobileIdleLockMinutes: number;
  /** Mobil uygulama arka plana geçince (operatör çıkınca) anında kilitlensin mi
   *  (default true). Idle kilitten bağımsız. Client ENFORCE (yalnız mobil). */
  mobileLockOnBackground: boolean;
  /** Mutlak oturum tavanı — gün (default 30, 0..365; 0 = süresiz). Zaman aşımı kapalı
   *  olsa bile token en fazla bu kadar gün yaşar (sızan token sonsuza kadar geçerli
   *  kalmasın). Backend ENFORCE eder (issueToken). */
  absoluteSessionCapDays: number;
  /** Hızlı PIN + kart giriş deneme kilidi açık mı (default true). Backend ENFORCE
   *  (login-lockout middleware). Kapalıyken deneme kilidi hiç uygulanmaz. */
  pinLockoutEnabled: boolean;
  /** Kilit tetiklenene kadar izin verilen ardışık yanlış deneme (default 5, 1..20). */
  pinLockoutAttempts: number;
  /** Kısa ceza süresi — saniye (default 60, 5..3600). Eşik aşılınca bu kadar bloklanır. */
  pinLockoutPenaltySec: number;
  /** Kaç ceza turundan sonra uzun cezaya geçilir (default 3, 1..20). */
  pinLockoutEscalateAfter: number;
  /** Uzun ceza süresi — dakika (default 15, 1..1440). Escalate eşiğine varınca uygulanır. */
  pinLockoutLongPenaltyMin: number;
  /** Aynı hesabın aynı tip cihazda 2. oturumuna karşı politika (default 'kick').
   *  kick = eskiyi düşür, notify = kullanıcıya sor, off = sınırsız. Backend (login) enforce. */
  sameTypeSessionPolicy: SameTypeSessionPolicy;
  /** Mobil giriş yöntemleri: list (kullanıcı+şifre), pin (SALT hızlı-PIN — kullanıcı
   *  seçme yok, benzersiz PIN), card (QR personel kartı). En az biri etkin; login
   *  ekranı primary ile açılır, diğerleri "Diğer giriş yöntemleri"nde. Backend ENFORCE. */
  loginMethods: { enabled: LoginMethod[]; primary: LoginMethod };
  /** Saha #6: top etiketi kopya adedi (default 2 — topun üstüne + altına). 1-5. */
  labelCopies: number;
  /** Faz-2 opt-in: native komutları yazıcıya doğrudan (RAW TCP 9100) gönder (default false). */
  nativeSendEnabled: boolean;
  /** Mobil (HC-06/BT) baskıda raster GW bitmap gönderilsin mi (default false → komut yolu).
   *  Electron raster'ından (PeripheralDevice.rasterMode) bağımsız; sahada yavaşsa kapatılır. */
  mobileRasterEnabled: boolean;
  /** Cihazsız baskı/önizleme (Etiket Stüdyosu, kartela) için sistem varsayılan etiket
   *  medyası. Yazıcı cihazı seçiliyse onun medyası önceliklidir; bu yalnız fallback. */
  defaultLabelMedia: DefaultLabelMedia;
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

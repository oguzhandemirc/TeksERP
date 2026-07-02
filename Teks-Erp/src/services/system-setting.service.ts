// =============================================================================
// TeksERP - System Setting Service
// =============================================================================
// Runtime'da güncellenebilir konfigürasyon (key-value).
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma, PrinterLanguage } from "@prisma/client";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";

/**
 * SystemSetting.value bir JsonValue. Reader yardımcıları: gelen değer
 * hangi tipte olursa olsun beklenen tipe çevirmeye çalışır (backward
 * compatible — eski string-encoded değerleri de okur).
 */
function asNumber(value: Prisma.JsonValue | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: Prisma.JsonValue | null | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return false;
}

const TABLE = "SYSTEM_SETTING";

export const SETTING_KEYS = {
  SHIPPING_TOLERANCE_METERS: "shipping.toleranceMeters",
  /** Pricing/currency UI'da gösterilsin mi (sipariş ve ileride sevkiyat). */
  FINANCE_PRICING_ENABLED: "finance.pricingEnabled",
  /** İş emrinde "hedef metraj" alanı gösterilsin mi. Default false (proses-only fabrika). */
  WORKORDER_TARGET_QUANTITY_ENABLED: "workorder.targetQuantityEnabled",
  /** KK1 ham kumaş girişinde "en" alanı gösterilsin mi. Default false (ham en önemsiz). */
  KK1_RAW_WIDTH_ENABLED: "kk1.rawWidthEnabled",
  /** İade kabulünde personel topun kalitesini değiştirebilsin mi. Default false
   *  (kapalıyken kalite butonu gizlenir + backend gönderilen override'ı yok sayar). */
  RETURN_GRADING_ENABLED: "return.gradingEnabled",
  /** Kartela kabulünde uzunluk(cm)/ağırlık(kg) alanları gösterilsin mi. Default false
   *  (bu firma kartelayı yalnız ADET sayar; kapalıyken kabul ekranında ve kartela
   *  listelerinde cm/kg gizlenir). Başka firmalara açık satılabilir. Backend ENFORCE
   *  etmez — salt UI rehberi; gizlenince zaten null gelir. */
  KARTELA_MEASUREMENT_ENABLED: "kartela.measurementEnabled",
  /** İş emri "Parti Kodu" (batchNumber) otomatik mi üretilsin manuel mi girilsin.
   *  Default false (manuel). Açıkken form otomatik P-YYMMDD-NNN önerir, override edilebilir. */
  WORKORDER_PARTY_CODE_AUTO: "workorder.partyCodeAuto",
  /** Sipariş oluştururken termin (deadline) verilmediyse orderDate + N gün. Default 7. */
  ORDER_DEFAULT_DEADLINE_DAYS: "order.defaultDeadlineDays",
  /** İş emri oluştururken plannedEndDate verilmediyse plannedStartDate + N gün. Default 7. */
  WORKORDER_DEFAULT_PLAN_DURATION_DAYS: "workorder.defaultPlanDurationDays",
  /** Sahadaki operatör Fason Sevk'te fason talimatını telefondan girebilsin mi.
   *  Default false (kapalı) → talimat yalnızca adım notundan gelir; mobil alan gizli. */
  FASON_NOTE_MOBILE_ENTRY: "fason.noteMobileEntry",
  /** Mobil cihaz eşleştirmesi ZORUNLU mu. Default false (pasif) → eşleşmemiş
   *  tabletler de giriş yapıp çalışabilir (makine atfı NULL kalır). True iken
   *  eşleşmemiş/pasif cihaz device.middleware'de 401 ile kesilir. ENFORCE edilir. */
  DEVICE_PAIRING_REQUIRED: "device.pairingRequired",
  /** Sevk için ayrı "ambar aldı / çıkış" onay adımı zorunlu mu. Default false (kapalı):
   *  paketleyen ① ekranından "Hemen Sevk Et" ile direkt sevk edebilir. Açıkken ① sadece
   *  "Sevke Hazır" yapar; çıkış yalnız ② "Sevk Çıkışı" ekranından onaylanır. Sadece UI
   *  rehberi — backend ENFORCE ETMEZ (her iki yoldan da dispatch kabul edilir). */
  SHIPMENT_CONFIRMATION_ENABLED: "shipping.confirmationEnabled",
  /** Refakat kartı marka/içerik ayarı (JSON): firma adı + hangi bölümler basılsın.
   *  Kart oluşturulurken snapshot'a DONDURULUR → reprint düzeni de sabit kalır. */
  TRAVELER_CARD_CONFIG: "traveler.cardConfig",
  /** ERP'nin kurulduğu firmanın adı — panel başlığı + uygulama genelinde gösterilir.
   *  Refakat kartının kendi firma adından bağımsızdır (kart snapshot'ı ayrı tutulur). */
  COMPANY_NAME: "company.name",
  /** Belge künyesi: irsaliye/çeki başına basılan firma adresi/telefon/vergi bilgisi.
   *  Firma adı ayrı (COMPANY_NAME); burada sadece ek künye satırları. */
  COMPANY_LETTERHEAD: "company.letterhead",
  /** Yazdırılan belgelerin (sevk irsaliyesi, fason sevk, kartela çeki) içerik ayarı:
   *  hangi bölümler basılsın + başlık/imza/footer override. CANLI okunur (snapshot DEĞİL)
   *  — irsaliye her açıldığında güncel ayarı yansıtır. Map: { [belgeKey]: DocumentConfig }. */
  DOCUMENTS_CONFIG: "documents.config",
  /** Tambur'da çıkan top metresi kayıtlı (giriş) metreyi AŞABİLSİN mi. Default TRUE (açık).
   *  Açıkken operatör tambur asıl ölçüm noktası olduğu için kayıtlıdan fazla ölçtüğünde (örn.
   *  100m açık kumaşı 150m top yapma) kabul edilir; aşımda parent top tamamen tüketilir. Admin
   *  kapatırsa çıkış ≤ giriş zorunlu olur (aşan giriş 400 ile reddedilir). Diğer flag'lerin
   *  aksine backend ENFORCE eder (guard bu flag'e bağlı). */
  TAMBUR_OVER_QUANTITY_ENABLED: "tambur.overQuantityEnabled",
  /** Oturum (JWT token) ömrü, SAAT. Default 8. Giriş yaptıktan sonra token kaç saat
   *  geçerli kalır — süre dolunca (aktif kullanırken bile) yeniden giriş gerekir.
   *  Backend ENFORCE eder: login'de jwt.sign expiresIn buradan okunur. Değişiklik
   *  yalnız sonraki girişlere uygulanır; mevcut açık token'lar kendi süreleriyle biter. */
  AUTH_SESSION_DURATION_HOURS: "auth.sessionDurationHours",
  /** Hareketsizlik (idle) zaman aşımı, DAKİKA. Default 0 (kapalı). >0 iken Electron
   *  paneli bu kadar dakika hiç işlem (fare/klavye) görmezse otomatik çıkış yapar.
   *  Frontend ENFORCE eder (backend token'ı yine kendi mutlak ömrüne kadar geçerli). */
  AUTH_IDLE_TIMEOUT_MINUTES: "auth.idleTimeoutMinutes",
  /** Çalışma oturumu (WorkSession — kim hangi makinede) hareketsizlik zaman aşımı,
   *  DAKİKA. Default 600 (10 saat: vardiya boyu molalarda düşmez, gece açık unutulan
   *  tablet sabaha temiz oturumla başlar). 0 = kapalı. Backend TEMBEL enforce eder:
   *  timer YOK — aktif oturum okunurken lastActivityAt bu süreden eskiyse IDLE ile
   *  kapatılır (work-session.helper). auth.idleTimeoutMinutes'ten (ekran kilidi) AYRI. */
  WORK_SESSION_IDLE_TIMEOUT_MINUTES: "workSession.idleTimeoutMinutes",
  /** ESKİ mobil giriş yöntemi ("pin"|"card") — AUTH_LOGIN_METHODS'a evrildi; yalnız
   *  geriye-uyum okuma için tutulur (yeni key yoksa buradan türetilir). Yazılmaz. */
  AUTH_LOGIN_MODE: "auth.loginMode",
  /** Mobil giriş yöntemleri (JSON): { enabled: ("list"|"pin"|"card")[], primary }.
   *  list = kullanıcı listesi + şifre/PIN (klasik); pin = SALT hızlı-PIN (kullanıcı
   *  seçme yok — users.quickPin benzersiz); card = QR personel kartı. En az bir
   *  yöntem etkin, primary etkinlerden biri. Login ekranı primary ile açılır;
   *  diğer etkin yöntemler "Diğer giriş yöntemleri"nde sunulur. Backend ENFORCE:
   *  login-card yalnız card, login-quick-pin yalnız pin etkinken çalışır
   *  (klasik /auth/login HEP açık — Electron paneli + acil kapı). */
  AUTH_LOGIN_METHODS: "auth.loginMethods",
  /** Saha #6: top etiketi kaç kopya basılır (default 2 — topun bir üstüne bir
   *  altına yapıştırılıyor). /labels/rolls/:id/html bu kadar sayfa döner;
   *  çağıran ?copies= ile tek baskı için override edebilir. 1-5 arası. */
  LABEL_COPIES: "label.copies",
  /** Saha #20: top adı (birleşik ürün tanımı) format şablonu. Token'lar:
   *  {item} {color} {width} {quality}. Default "{item} {color} {width}". Boş
   *  token'lar (renksiz vb.) atlanır, fazla boşluk sadeleşir. Frontend okur. */
  ROLL_NAME_TEMPLATE: "roll.nameTemplate",
  /** Varsayılan etiket yazıcı dili — top etiketi native render'ı bu dilde üretilir
   *  (default PPLA). Bir yazıcı modeli kendi dilini belirtirse (Argox=PPLA, Zebra=ZPL)
   *  o istasyonda model dili ÖNCELİKLİDİR; bu global ayar model bağlamı çözülemeyen
   *  baskılar için (Electron/varsayılan) ve genel varsayılan olarak kullanılır. */
  LABEL_PRINTER_LANGUAGE: "label.printerLanguage",
  /** Faz-2 opt-in: native etiket komutları (PPLA/ZPL) backend RAW TCP (9100) ile
   *  yazıcıya DOĞRUDAN gönderilsin mi (default false = Faz-1 simülasyon). Açıkken
   *  ENFORCE — printer-transport gerçek socket açar; kapalıyken hiç socket yok. */
  LABEL_NATIVE_SEND_ENABLED: "label.nativeSendEnabled",
} as const;

const DEFAULT_DEADLINE_DAYS = 7;

/** Oturum (JWT) ömrü varsayılanı — saat. Eski sabit "8h" davranışıyla aynı. */
export const DEFAULT_SESSION_DURATION_HOURS = 8;
/** Mutlak oturum ömrü tavanı — saat (30 gün). Üstü bu değere kırpılır. */
const MAX_SESSION_DURATION_HOURS = 720;
/** Hareketsizlik zaman aşımı varsayılanı — dakika. 0 = kapalı (otomatik çıkış yok). */
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 0;
/** Hareketsizlik zaman aşımı tavanı — dakika (24 saat). */
const MAX_IDLE_TIMEOUT_MINUTES = 1440;
/** Çalışma oturumu (WorkSession) idle varsayılanı — dakika (10 saat). 0 = kapalı. */
export const DEFAULT_WORK_SESSION_IDLE_MINUTES = 600;
/** Çalışma oturumu idle tavanı — dakika (24 saat). */
const MAX_WORK_SESSION_IDLE_MINUTES = 1440;
/** Mobil giriş yöntemleri. list=liste+şifre, pin=salt hızlı-PIN, card=QR kart. */
export type LoginMethod = "list" | "pin" | "card";
export interface LoginMethodsConfig {
  enabled: LoginMethod[];
  primary: LoginMethod;
}
export const LOGIN_METHODS: LoginMethod[] = ["list", "pin", "card"];
export const DEFAULT_LOGIN_METHODS: LoginMethodsConfig = { enabled: ["list"], primary: "list" };

/** Firma adı verilmediğinde gösterilen varsayılan. */
export const DEFAULT_COMPANY_NAME = "Adnan Şahin Tekstil";

/** Refakat kartı sayfa boyutu. */
export type TravelerCardPageSize = "A4" | "A5";

/** Refakat kartı kenar boşlukları (mm) — pay bırakmak için (ciltleme/delik zımbası). */
export interface TravelerCardMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Yazı kalınlığı — tüm font-weight'leri kaydırır (ince −100, kalın +100). */
export type TravelerCardFontWeight = "light" | "normal" | "bold";

/** Alan boyutu — sm/md/lg. */
export type TravelerCardFieldSize = "sm" | "md" | "lg";

/** Tek spec alanı — göster + boyut + kalınlık (alan-başına bağımsız müdahale). */
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

/** Bağlı siparişler tablosu sütunları — her biri tek tek (göster/boyut/kalınlık). */
export interface TravelerCardOrderFields {
  orderNumber: TravelerCardSpecField;
  customer: TravelerCardSpecField;
  item: TravelerCardSpecField;
  color: TravelerCardSpecField;
  quantity: TravelerCardSpecField;
}

/** Ham değeri (boolean eski şekil | nesne | undefined) tam spec alanına çözer. */
export function coerceSpecField(v: unknown): TravelerCardSpecField {
  if (v === false) return { show: false, size: "md", weight: "normal" };
  if (v == null || v === true) return { show: true, size: "md", weight: "normal" };
  const f = v as Record<string, unknown>;
  return {
    show: f.show !== false,
    size: f.size === "sm" || f.size === "lg" ? f.size : "md",
    weight: f.weight === "light" || f.weight === "bold" ? f.weight : "normal",
  };
}

/** Refakat kartı marka/içerik ayarı. Snapshot'a dondurulur. */
export interface TravelerCardConfig {
  /** Kart başlığındaki firma adı. */
  companyName: string;
  /** Firma adının altında basılan adres satırı (boş → basılmaz). */
  addressLine: string;
  /** Firma adının altında basılan telefon (boş → basılmaz). */
  phone: string;
  /** Sayfa boyutu — A4 (standart) veya A5. */
  pageSize: TravelerCardPageSize;
  /** Kenar boşlukları (mm) — hangi kenardan ne kadar pay. */
  margins: TravelerCardMargins;
  /** Yazı boyutu ölçeği — tüm yazılar bununla çarpılır (0.7–1.4, default 1). */
  fontScale: number;
  /** Yazı kalınlığı — ince/normal/kalın. */
  fontWeight: TravelerCardFontWeight;
  /** Operasyon imza grid'i basılsın mı. */
  showOperationGrid: boolean;
  /** Talimatlar/Boyahane notu kutusu basılsın mı. */
  showNotes: boolean;
  /** Bağlı siparişler tablosu basılsın mı. */
  showOrders: boolean;
  /** Özellikler (ÖZELLİKLER) satırı basılsın mı. */
  showProperties: boolean;
  /** Spec grid alanları (Renk/En/Hedef Metraj/... tek tek). */
  specFields: TravelerCardSpecFields;
  /** Spec grid'de satır başına sütun sayısı (1–4, default 3). */
  specColumns: number;
  /** Bağlı siparişler tablosu sütunları (Sipariş No/Müşteri/Ürün/Renk/Miktar tek tek). */
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

/** Ham objeyi (kaydet girişi / saklanan değer) tam + güvenli TravelerCardConfig'e çözer.
 *  Kaydet ve oku yolları paylaşır → drift yok. Eksik alan → default açık/değer. */
export function normalizeTravelerCardConfig(o: Record<string, unknown>): TravelerCardConfig {
  const D = DEFAULT_TRAVELER_CARD_CONFIG;
  const mm = (v: unknown, def: number): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(40, Math.max(0, Math.round(n))) : def;
  };
  const m = (o.margins && typeof o.margins === "object" ? o.margins : {}) as Record<string, unknown>;
  const sf = (o.specFields && typeof o.specFields === "object" ? o.specFields : {}) as Record<string, unknown>;
  const of = (o.orderFields && typeof o.orderFields === "object" ? o.orderFields : {}) as Record<string, unknown>;
  return {
    companyName:
      typeof o.companyName === "string" && o.companyName.trim()
        ? o.companyName.trim().slice(0, 120)
        : D.companyName,
    addressLine: typeof o.addressLine === "string" ? o.addressLine.trim().slice(0, 200) : "",
    phone: typeof o.phone === "string" ? o.phone.trim().slice(0, 60) : "",
    pageSize: o.pageSize === "A5" ? "A5" : "A4",
    margins: {
      top: mm(m.top, D.margins.top),
      right: mm(m.right, D.margins.right),
      bottom: mm(m.bottom, D.margins.bottom),
      left: mm(m.left, D.margins.left),
    },
    fontScale: (() => {
      const n = typeof o.fontScale === "number" ? o.fontScale : Number(o.fontScale);
      return Number.isFinite(n) ? Math.min(1.4, Math.max(0.7, n)) : 1;
    })(),
    fontWeight: o.fontWeight === "light" || o.fontWeight === "bold" ? o.fontWeight : "normal",
    showOperationGrid: o.showOperationGrid !== false,
    showNotes: o.showNotes !== false,
    showOrders: o.showOrders !== false,
    showProperties: o.showProperties !== false,
    specFields: {
      color: coerceSpecField(sf.color),
      width: coerceSpecField(sf.width),
      targetQuantity: coerceSpecField(sf.targetQuantity),
      targetWeight: coerceSpecField(sf.targetWeight),
      foldType: coerceSpecField(sf.foldType),
      startDate: coerceSpecField(sf.startDate),
      endDate: coerceSpecField(sf.endDate),
    },
    specColumns: (() => {
      const n = typeof o.specColumns === "number" ? o.specColumns : Number(o.specColumns);
      return Number.isFinite(n) ? Math.min(4, Math.max(1, Math.round(n))) : 3;
    })(),
    orderFields: {
      orderNumber: coerceSpecField(of.orderNumber),
      customer: coerceSpecField(of.customer),
      item: coerceSpecField(of.item),
      color: coerceSpecField(of.color),
      quantity: coerceSpecField(of.quantity),
    },
    // Toplam: yeni orderTotal nesnesi > eski showOrderTotal boolean; varsayılan KALIN.
    orderTotal: coerceSpecField(o.orderTotal ?? { show: o.showOrderTotal !== false, size: "md", weight: "bold" }),
    footerNote: typeof o.footerNote === "string" ? o.footerNote.trim().slice(0, 500) : "",
  };
}

/** Belge künyesi — irsaliye/çeki başına basılan ek firma bilgisi (firma adı ayrı). */
export interface CompanyLetterhead {
  /** Firma adresi (boş → basılmaz). */
  addressLine: string;
  /** Telefon (boş → basılmaz). */
  phone: string;
  /** Vergi dairesi / no (boş → basılmaz). */
  taxInfo: string;
}

export const DEFAULT_COMPANY_LETTERHEAD: CompanyLetterhead = {
  addressLine: "",
  phone: "",
  taxInfo: "",
};

/**
 * Yazdırılan belge içerik ayarı (sevk irsaliyesi / fason sevk / kartela çeki).
 * Tüm alanlar opsiyonel — verilmeyen alan client tarafında belge kayıt defterindeki
 * (DOC_DEFS) varsayılana çözülür (resolveDocConfig). Backend SADECE saklar; çözüm
 * client'ta (Electron/mobil) yapılır.
 */
export interface DocumentConfig {
  /** Belge başlığı override ("" / verilmedi → varsayılan başlık). */
  titleOverride?: string;
  /** Üst künye bloğu (firma adı + adres/tel/vergi) basılsın mı (default false). */
  showLetterhead?: boolean;
  /** Bölüm görünürlükleri: { [bölümKey]: boolean }. Verilmeyen bölüm → açık. */
  sections?: Record<string, boolean>;
  /** İmza kutusu etiketleri (boş dizi → varsayılan etiketler). */
  signatureLabels?: string[];
  /** İmza kutuları basılsın mı (default true). */
  showSignatures?: boolean;
  /** Belge altına basılan serbest not. */
  footerNote?: string;
}

/** Belge ayarları haritası: { [belgeKey]: DocumentConfig }. Ham saklanır, client çözer. */
export type DocumentsConfig = Record<string, DocumentConfig>;

/**
 * Tüm public feature flag'lerin tek atışta okunmuş hali. Frontend app
 * açılışında 1 kez çekip context'e koyar; UI bu flag'lere göre alanları
 * gösterir/gizler. Backend tarafı feature flag'i ENFORCE ETMEZ — sadece
 * UI rehberi (admin/test araçları field'ları gönderebilir).
 */
export interface FeatureFlags {
  /** ERP'nin kurulduğu firmanın adı (panel başlığı + uygulama geneli). */
  companyName: string;
  pricingEnabled: boolean;
  targetQuantityEnabled: boolean;
  rawWidthEnabled: boolean;
  returnGradingEnabled: boolean;
  /** Kartela kabulünde cm/kg ölçü alanları + kartela listelerinde ölçü gösterimi
   *  açık mı (default false — yalnız ADET). */
  kartelaMeasurementEnabled: boolean;
  partyCodeAuto: boolean;
  fasonNoteMobileEntry: boolean;
  /** Cihaz eşleştirme zorunlu mu (true=aktif) yoksa pasif mi (false=default).
   *  Diğerlerinden farklı olarak ENFORCE edilir (device.middleware). */
  devicePairingRequired: boolean;
  /** Sevk için ayrı "ambar aldı / çıkış" onay adımı zorunlu mu (default false). */
  shipmentConfirmationEnabled: boolean;
  /** Refakat kartı marka/içerik ayarı (firma adı + bölüm görünürlükleri). */
  travelerCardConfig: TravelerCardConfig;
  /** Belge künyesi (adres/tel/vergi) — irsaliye/çeki üst bloğunda basılır. */
  companyLetterhead: CompanyLetterhead;
  /** Yazdırılan belgelerin içerik ayarı (canlı). Ham map; client resolveDocConfig ile çözer. */
  documentsConfig: DocumentsConfig;
  /** Tambur'da çıkan top metresi kayıtlı (giriş) metreyi aşabilsin mi (default TRUE/açık).
   *  Diğer flag'lerin aksine ENFORCE edilir — tambur kesim guard'ı bu flag'e bağlı. */
  tamburOverQuantityEnabled: boolean;
  /** Oturum (JWT) ömrü — saat (default 8). Giriş sonrası token kaç saat geçerli.
   *  Backend ENFORCE eder (login'de jwt.sign expiresIn). */
  sessionDurationHours: number;
  /** Hareketsizlik zaman aşımı — dakika (default 0 = kapalı). Panel bu kadar dakika
   *  işlem görmezse otomatik çıkış. Frontend ENFORCE eder. */
  idleTimeoutMinutes: number;
  /** Çalışma oturumu (kim hangi makinede) idle zaman aşımı — dakika (default 600 =
   *  10 saat; 0 = kapalı). Backend TEMBEL enforce eder (okuma anında IDLE kapatma). */
  workSessionIdleTimeoutMinutes: number;
  /** Mobil giriş yöntemleri: { enabled: ("list"|"pin"|"card")[], primary }. Login
   *  ekranı primary ile açılır; diğer etkinler "Diğer giriş yöntemleri"nde. Backend
   *  ENFORCE — card/pin uçları yalnız etkinken çalışır (klasik login hep açık). */
  loginMethods: LoginMethodsConfig;
  /** Saha #6: top etiketi kopya adedi (default 2 — üst+alt yapıştırma). 1-5. */
  labelCopies: number;
  /** Saha #20: top adı format şablonu ({item} {color} {width} {quality}). Frontend okur. */
  rollNameTemplate: string;
  /** Varsayılan etiket yazıcı dili (RASTER_HTML | PPLA | PPLB | ZPL; default PPLA).
   *  Native render bu dilde üretilir; istasyon yazıcı modeli kendi dilini belirtirse o önceliklidir. */
  printerLanguage: PrinterLanguage;
  /** Faz-2 opt-in: native komutları yazıcıya doğrudan (RAW TCP 9100) gönder (default false). */
  nativeSendEnabled: boolean;
}

// =============================================================================
// Feature-flag agregat cache
// =============================================================================
// getFeatureFlags() her çağrıda 15 ayrı systemSetting.findUnique çalıştırıyor;
// GET /api/feature-flags app açılışında + her gezinmede sık çağrılır. Toplam
// sonucu kısa TTL ile bellekte tutuyoruz. set() HER ayar yazımında invalidate
// eder (tek write chokepoint) → toggle anında taze görünür.
// ÖNEMLİ: per-flag enforcement reader'ları (readReturnGradingEnabled(tx),
// readDevicePairingRequired, readTamburOverQuantityEnabled ...) KASITEN cache'siz
// kalır — transaction içi + middleware tazeliği aynen korunur. Tek-sunucu yerel
// kurulum → bellek cache yeterli (TTL ayrıca olası out-of-band değişimi bounded tutar).
let featureFlagsCache: { value: FeatureFlags; expiresAt: number } | null = null;
const FEATURE_FLAGS_TTL_MS = 30_000;
// Lost-invalidation guard: getFeatureFlags okumaya BAŞLAMADAN önce bu sayacı yakalar.
// findMany sürerken araya bir set()+invalidate girerse sayaç artar ve okuma bayat
// veriyi cache'e YAZMAZ (taze döner) — yoksa pencerede başlamış okuma, invalidate'i
// "atlayıp" eski değeri TTL boyunca (30sn) pinleyebiliyordu (enforced flag'ler için
// geçici yanlış davranış). NOT: tek-process varsayımı (process-local sayaç).
let cacheGeneration = 0;

export function invalidateFeatureFlagsCache(): void {
  featureFlagsCache = null;
  cacheGeneration++;
}

export class SystemSettingService {
  async list(): Promise<ApiResponse<unknown[]>> {
    const items = await prisma.systemSetting.findMany({
      orderBy: { key: "asc" },
      include: {
        updatedBy: { select: { id: true, fullName: true } },
      },
    });
    return { success: true, data: items };
  }

  async get(key: string): Promise<ApiResponse<unknown | null>> {
    const item = await prisma.systemSetting.findUnique({ where: { key } });
    return { success: true, data: item };
  }

  /**
   * Upsert: yoksa oluştur, varsa güncelle.
   * description sadece ilk oluşturmada set edilir; sonraki update'lerde değişmez
   * (admin niyetlerinin bozulmaması için).
   */
  async set(
    key: string,
    value: Prisma.InputJsonValue,
    description: string | undefined,
    userId: string | undefined
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();

    const existing = await prisma.systemSetting.findUnique({ where: { key } });

    const updated = await prisma.systemSetting.upsert({
      where: { key },
      create: {
        key,
        value,
        description: description ?? null,
        updatedById: userId,
      },
      update: {
        value,
        updatedById: userId,
      },
    });

    await AuditService.log({
      userId,
      action: existing ? "UPDATE" : "CREATE",
      tableName: TABLE,
      recordId: key,
      oldData: existing ? { value: existing.value as Prisma.InputJsonValue } : null,
      newData: { value: updated.value as Prisma.InputJsonValue },
    });

    // Herhangi bir ayar yazımı feature-flag agregat cache'ini bayatlatabilir →
    // tek write chokepoint burada invalidate eder (toggle anında taze görünür).
    invalidateFeatureFlagsCache();

    return { success: true, data: updated, message: "Ayar güncellendi" };
  }

  /**
   * Tolerance değerini DB'den okur. Kayıt yoksa default 5m döner.
   * NOT: Bu fonksiyon çok sık çağrılmaz (sevk onayı sırasında); cache'siz kabul.
   */
  async getShippingToleranceMeters(): Promise<number> {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: SETTING_KEYS.SHIPPING_TOLERANCE_METERS },
      select: { value: true },
    });
    if (!setting) return 5;
    const parsed = asNumber(setting.value);
    if (parsed === null || parsed < 0) return 5;
    return parsed;
  }

  /**
   * Tüm feature flag'leri tek atışta. Default: tüm flag'ler false (en
   * konservatif — fabrika fiyat görmek istemiyor şu an).
   */
  async getFeatureFlags(): Promise<ApiResponse<FeatureFlags>> {
    const now = Date.now();
    if (featureFlagsCache && featureFlagsCache.expiresAt > now) {
      return { success: true, data: featureFlagsCache.value };
    }
    const gen = cacheGeneration; // okumanın başladığı sürüm (lost-invalidation guard)
    // Tek sorguda tüm ayarları çek → reader'lara in-memory client enjekte et.
    // Eski kod 15 ardışık findUnique = 15 round-trip yapıyordu. Reader'lar her
    // flag'in key/parse/default mantığının TEK kaynağı kalır; yalnız veri kaynağı
    // DB yerine map olur (system_settings tablosu küçük → tüm satırları çekmek ucuz).
    const rows = await prisma.systemSetting.findMany({ select: { key: true, value: true } });
    const valueByKey = new Map(rows.map((r) => [r.key, r.value] as const));
    const cacheClient = {
      systemSetting: {
        findUnique: (args: { where: { key: string } }) =>
          Promise.resolve(
            valueByKey.has(args.where.key)
              ? { value: valueByKey.get(args.where.key) }
              : null,
          ),
      },
    } as unknown as Pick<typeof prisma, "systemSetting">;

    const flags: FeatureFlags = {
      companyName: await readCompanyName(cacheClient),
      pricingEnabled: await readPricingEnabled(cacheClient),
      targetQuantityEnabled: await readTargetQuantityEnabled(cacheClient),
      rawWidthEnabled: await readRawWidthEnabled(cacheClient),
      returnGradingEnabled: await readReturnGradingEnabled(cacheClient),
      kartelaMeasurementEnabled: await readKartelaMeasurementEnabled(cacheClient),
      partyCodeAuto: await readPartyCodeAuto(cacheClient),
      fasonNoteMobileEntry: await readFasonNoteMobileEntry(cacheClient),
      devicePairingRequired: await readDevicePairingRequired(cacheClient),
      shipmentConfirmationEnabled: await readShipmentConfirmationEnabled(cacheClient),
      travelerCardConfig: await readTravelerCardConfig(cacheClient),
      companyLetterhead: await readCompanyLetterhead(cacheClient),
      documentsConfig: await readDocumentsConfig(cacheClient),
      tamburOverQuantityEnabled: await readTamburOverQuantityEnabled(cacheClient),
      sessionDurationHours: await readSessionDurationHours(cacheClient),
      idleTimeoutMinutes: await readIdleTimeoutMinutes(cacheClient),
      workSessionIdleTimeoutMinutes: await readWorkSessionIdleTimeoutMinutes(cacheClient),
      loginMethods: await readLoginMethods(cacheClient),
      labelCopies: await readLabelCopies(cacheClient),
      rollNameTemplate: await readRollNameTemplate(cacheClient),
      printerLanguage: await readPrinterLanguage(cacheClient),
      nativeSendEnabled: await readLabelNativeSendEnabled(cacheClient),
    };
    // Yalnız okuma sürerken invalidate OLMADIYSA cache'le; olduysa bayat veriyi
    // pinleme (taze değeri döndür, cache'i bir sonraki okuma tazeler).
    if (cacheGeneration === gen) {
      featureFlagsCache = { value: flags, expiresAt: now + FEATURE_FLAGS_TTL_MS };
    }
    return { success: true, data: flags };
  }

  /**
   * Bir feature flag'i toggle et. Kabul: { pricingEnabled: boolean }.
   * Verilmeyen alanlar dokunulmaz.
   */
  async setFeatureFlags(
    input: Partial<FeatureFlags>,
    userId: string | undefined
  ): Promise<ApiResponse<FeatureFlags>> {
    if (!userId) throw AppError.unauthorized();

    if (Object.prototype.hasOwnProperty.call(input, "pricingEnabled")) {
      if (typeof input.pricingEnabled !== "boolean") {
        throw AppError.badRequest("pricingEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.FINANCE_PRICING_ENABLED,
        input.pricingEnabled,
        "Sipariş/sevkiyat ekranlarında para birimi + fiyat alanlarını göster",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "targetQuantityEnabled")) {
      if (typeof input.targetQuantityEnabled !== "boolean") {
        throw AppError.badRequest("targetQuantityEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.WORKORDER_TARGET_QUANTITY_ENABLED,
        input.targetQuantityEnabled,
        "İş emri formunda hedef metraj alanını göster",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "rawWidthEnabled")) {
      if (typeof input.rawWidthEnabled !== "boolean") {
        throw AppError.badRequest("rawWidthEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.KK1_RAW_WIDTH_ENABLED,
        input.rawWidthEnabled,
        "KK1 ham kumaş girişinde en (cm) alanını göster",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "returnGradingEnabled")) {
      if (typeof input.returnGradingEnabled !== "boolean") {
        throw AppError.badRequest("returnGradingEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.RETURN_GRADING_ENABLED,
        input.returnGradingEnabled,
        "İade kabulünde personel topun kalitesini değiştirebilsin",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "kartelaMeasurementEnabled")) {
      if (typeof input.kartelaMeasurementEnabled !== "boolean") {
        throw AppError.badRequest("kartelaMeasurementEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.KARTELA_MEASUREMENT_ENABLED,
        input.kartelaMeasurementEnabled,
        "Kartela kabulünde uzunluk(cm)/ağırlık(kg) alanlarını göster",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "partyCodeAuto")) {
      if (typeof input.partyCodeAuto !== "boolean") {
        throw AppError.badRequest("partyCodeAuto boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.WORKORDER_PARTY_CODE_AUTO,
        input.partyCodeAuto,
        "İş emri parti kodunu otomatik üret (manuel giriş yerine)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "fasonNoteMobileEntry")) {
      if (typeof input.fasonNoteMobileEntry !== "boolean") {
        throw AppError.badRequest("fasonNoteMobileEntry boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.FASON_NOTE_MOBILE_ENTRY,
        input.fasonNoteMobileEntry,
        "Fason Sevk'te fason talimatını sahadaki operatör telefondan girebilsin",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "devicePairingRequired")) {
      if (typeof input.devicePairingRequired !== "boolean") {
        throw AppError.badRequest("devicePairingRequired boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.DEVICE_PAIRING_REQUIRED,
        input.devicePairingRequired,
        "Mobil cihaz eşleştirmesi zorunlu olsun (kapalıyken eşleşmemiş cihazlar da girer)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "shipmentConfirmationEnabled")) {
      if (typeof input.shipmentConfirmationEnabled !== "boolean") {
        throw AppError.badRequest("shipmentConfirmationEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED,
        input.shipmentConfirmationEnabled,
        "Sevk için ayrı 'ambar aldı / çıkış' onay adımı zorunlu olsun (kapalıyken paketleyen direkt sevk eder)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "companyName")) {
      if (typeof input.companyName !== "string") {
        throw AppError.badRequest("companyName metin olmalı");
      }
      const trimmed = input.companyName.trim().slice(0, 120);
      await this.set(
        SETTING_KEYS.COMPANY_NAME,
        trimmed || DEFAULT_COMPANY_NAME,
        "ERP'nin kurulduğu firmanın adı (panel başlığı + uygulama geneli)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "travelerCardConfig")) {
      const c = input.travelerCardConfig;
      if (!c || typeof c !== "object") {
        throw AppError.badRequest("travelerCardConfig nesne olmalı");
      }
      const merged = normalizeTravelerCardConfig(c as unknown as Record<string, unknown>);
      await this.set(
        SETTING_KEYS.TRAVELER_CARD_CONFIG,
        merged as unknown as Prisma.InputJsonValue,
        "Refakat kartı marka/içerik ayarı (firma adı + boyut/pay + bölüm/alan görünürlükleri)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "companyLetterhead")) {
      const c = input.companyLetterhead;
      if (!c || typeof c !== "object") {
        throw AppError.badRequest("companyLetterhead nesne olmalı");
      }
      const merged: CompanyLetterhead = {
        addressLine:
          typeof c.addressLine === "string" ? c.addressLine.trim().slice(0, 200) : "",
        phone: typeof c.phone === "string" ? c.phone.trim().slice(0, 60) : "",
        taxInfo: typeof c.taxInfo === "string" ? c.taxInfo.trim().slice(0, 120) : "",
      };
      await this.set(
        SETTING_KEYS.COMPANY_LETTERHEAD,
        merged as unknown as Prisma.InputJsonValue,
        "Belge künyesi (irsaliye/çeki üst bloğunda basılan adres/telefon/vergi)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "documentsConfig")) {
      const c = input.documentsConfig;
      if (!c || typeof c !== "object" || Array.isArray(c)) {
        throw AppError.badRequest("documentsConfig nesne olmalı");
      }
      await this.set(
        SETTING_KEYS.DOCUMENTS_CONFIG,
        sanitizeDocumentsConfig(c) as unknown as Prisma.InputJsonValue,
        "Yazdırılan belge içerik ayarı (bölüm görünürlükleri + başlık/imza/footer)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "tamburOverQuantityEnabled")) {
      if (typeof input.tamburOverQuantityEnabled !== "boolean") {
        throw AppError.badRequest("tamburOverQuantityEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.TAMBUR_OVER_QUANTITY_ENABLED,
        input.tamburOverQuantityEnabled,
        "Tambur'da çıkan top metresi kayıtlı (giriş) metreyi aşabilsin (aşımda parent top tamamen tüketilir)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "sessionDurationHours")) {
      const v = input.sessionDurationHours;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < 1 ||
        v > MAX_SESSION_DURATION_HOURS
      ) {
        throw AppError.badRequest(
          `Oturum süresi 1–${MAX_SESSION_DURATION_HOURS} saat aralığında olmalı`
        );
      }
      await this.set(
        SETTING_KEYS.AUTH_SESSION_DURATION_HOURS,
        Math.floor(v),
        "Oturum (JWT token) ömrü, saat — giriş sonrası token kaç saat geçerli kalır",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "idleTimeoutMinutes")) {
      const v = input.idleTimeoutMinutes;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < 0 ||
        v > MAX_IDLE_TIMEOUT_MINUTES
      ) {
        throw AppError.badRequest(
          `Hareketsizlik zaman aşımı 0–${MAX_IDLE_TIMEOUT_MINUTES} dakika aralığında olmalı (0 = kapalı)`
        );
      }
      await this.set(
        SETTING_KEYS.AUTH_IDLE_TIMEOUT_MINUTES,
        Math.floor(v),
        "Hareketsizlik zaman aşımı, dakika — panel bu kadar süre işlem görmezse otomatik çıkış (0 = kapalı)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "workSessionIdleTimeoutMinutes")) {
      const v = input.workSessionIdleTimeoutMinutes;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < 0 ||
        v > MAX_WORK_SESSION_IDLE_MINUTES
      ) {
        throw AppError.badRequest(
          `Çalışma oturumu zaman aşımı 0–${MAX_WORK_SESSION_IDLE_MINUTES} dakika aralığında olmalı (0 = kapalı)`
        );
      }
      await this.set(
        SETTING_KEYS.WORK_SESSION_IDLE_TIMEOUT_MINUTES,
        Math.floor(v),
        "Çalışma oturumu (kim hangi makinede) hareketsizlik zaman aşımı, dakika — tembel IDLE kapatma (0 = kapalı)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "loginMethods")) {
      const v = input.loginMethods;
      const valid =
        v &&
        typeof v === "object" &&
        Array.isArray(v.enabled) &&
        v.enabled.length > 0 &&
        v.enabled.every((m) => LOGIN_METHODS.includes(m)) &&
        new Set(v.enabled).size === v.enabled.length &&
        LOGIN_METHODS.includes(v.primary) &&
        v.enabled.includes(v.primary);
      if (!valid) {
        throw AppError.badRequest(
          "Giriş yöntemleri geçersiz — en az bir yöntem (list/pin/card) etkin olmalı ve öncelikli yöntem etkinlerden biri olmalı",
        );
      }
      await this.set(
        SETTING_KEYS.AUTH_LOGIN_METHODS,
        { enabled: v.enabled, primary: v.primary },
        "Mobil giriş yöntemleri: list (kullanıcı+şifre), pin (salt hızlı-PIN), card (QR kart) + öncelikli yöntem",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "labelCopies")) {
      const v = input.labelCopies;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 1 || v > 5) {
        throw AppError.badRequest("Etiket kopya adedi 1–5 aralığında olmalı");
      }
      await this.set(
        SETTING_KEYS.LABEL_COPIES,
        Math.floor(v),
        "Top etiketi kopya adedi — bir baskıda kaç etiket çıkar (üst+alt için 2)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "rollNameTemplate")) {
      const v = input.rollNameTemplate;
      if (typeof v !== "string") {
        throw AppError.badRequest("Top adı şablonu metin olmalı");
      }
      const trimmed = v.trim();
      if (trimmed.length > 100) {
        throw AppError.badRequest("Top adı şablonu en fazla 100 karakter olabilir");
      }
      // En az bir geçerli token bulunmalı (boş/anlamsız şablon engellenir).
      if (trimmed && !/\{(item|color|width|quality)\}/.test(trimmed)) {
        throw AppError.badRequest("Şablon en az bir token içermeli: {item} {color} {width} {quality}");
      }
      await this.set(
        SETTING_KEYS.ROLL_NAME_TEMPLATE,
        trimmed || DEFAULT_ROLL_NAME_TEMPLATE,
        "Top adı format şablonu — {item} {color} {width} {quality} token'ları",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "printerLanguage")) {
      const v = input.printerLanguage;
      if (!PRINTER_LANGUAGES.includes(v as PrinterLanguage)) {
        throw AppError.badRequest(
          `Geçersiz yazıcı dili. İzinli: ${PRINTER_LANGUAGES.join(", ")}`,
        );
      }
      await this.set(
        SETTING_KEYS.LABEL_PRINTER_LANGUAGE,
        v as string,
        "Varsayılan etiket yazıcı dili (native render: PPLA/PPLB/ZPL veya HTML)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "nativeSendEnabled")) {
      if (typeof input.nativeSendEnabled !== "boolean") {
        throw AppError.badRequest("nativeSendEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.LABEL_NATIVE_SEND_ENABLED,
        input.nativeSendEnabled,
        "Faz-2: native etiket komutlarını yazıcıya doğrudan (RAW TCP 9100) gönder (kapalıyken simülasyon)",
        userId
      );
    }

    return this.getFeatureFlags();
  }
}

// Module-level singleton — helper'lar import edip kullanır.
export const systemSettingService = new SystemSettingService();

/**
 * Transaction içinden çağrılabilen tolerance okuma. tx verilirse aynı tx'i
 * kullanır (recomputeOrderStatus için kritik). tx yoksa dış prisma client.
 */
export async function readShippingToleranceMeters(
  tx?: Pick<typeof prisma, "systemSetting">
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_TOLERANCE_METERS },
    select: { value: true },
  });
  if (!setting) return 5;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 0) return 5;
  return parsed;
}

/**
 * Pricing/currency UI gösterilsin mi? Default false (kayıt yoksa). Frontend
 * bu flag'e göre order create/list/detail ekranlarındaki currency dropdown +
 * unitPrice + totalAmount alanlarını render eder.
 */
export async function readPricingEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_PRICING_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * İş emri "hedef metraj" alanı gösterilsin mi? Default false (proses-only
 * fabrika; üretim miktarını giren kumaş belirler). İleride örgü/üretim eklenirse açılır.
 */
export async function readTargetQuantityEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.WORKORDER_TARGET_QUANTITY_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * KK1 ham kumaş girişinde "en (cm)" alanı gösterilsin mi? Default false
 * (müşteri: ham kumaşın eni önemsiz). Kapalıyken mobil KK1 en alanını gizler,
 * operatör isterse manuel override ile yine girebilir. Bitmiş topun eni KK1'den
 * değil WorkOrder.width'ten damgalanır (bkz. tambur.service finalize).
 */
export async function readRawWidthEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KK1_RAW_WIDTH_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * İş emri "Parti Kodu" (batchNumber) otomatik mi üretilsin? Default false (manuel).
 * Sadece UI rehberi — backend ENFORCE ETMEZ: batchNumber boş gelirse her iki modda
 * da otomatik üretir. Flag yalnızca formun manuel/otomatik davranışını belirler.
 */
export async function readPartyCodeAuto(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.WORKORDER_PARTY_CODE_AUTO },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * İade kabulünde personel topun kalitesini değiştirebilsin mi? Default false.
 * Kapalıyken mobil İade ekranı kalite (derecelendirme) kontrolünü gizler; ayrıca
 * backend `createReturn`'de gönderilen qualityGradeId override'ı YOK SAYILIR
 * (top çıktığı kaliteyle döner) — flag fiziksel etiketi belirlediği için sadece
 * UI rehberi değil, enforce edilir.
 */
export async function readReturnGradingEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.RETURN_GRADING_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Kartela kabulünde cm/kg ölçü alanlarının + kartela listelerinde ölçü
 * gösteriminin açık olup olmadığı. Default false (yalnız ADET). Diğer UI
 * flag'leri gibi backend ENFORCE etmez; frontend gizler.
 */
export async function readKartelaMeasurementEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KARTELA_MEASUREMENT_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Fason Sevk'te fason talimatını sahadaki operatör telefondan girebilsin mi?
 * Default false (kapalı). Kapalıyken mobil Fason Sevk ekranında fason talimatı
 * alanı gizli; talimat yalnızca sevk edilen adımın notundan gelir. Sadece
 * UI rehberi — backend ENFORCE ETMEZ.
 */
export async function readFasonNoteMobileEntry(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FASON_NOTE_MOBILE_ENTRY },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Mobil cihaz eşleştirmesi ZORUNLU mu? Default false (pasif). Kapalıyken (default)
 * eşleşmemiş/kayıtsız tabletler de sisteme girebilir ve çalışır — ancak işledikleri
 * topta makine atfı (RollMovement/RollOperation.machineId) NULL kalır. Açıkken bugünkü
 * davranış: eşleşmemiş/pasif cihaz device.middleware'de 401 DEVICE_INACTIVE ile kesilir.
 * Diğer flag'lerin aksine ENFORCE edilir (middleware + mobileUsers + mobil pairing gate).
 */
export async function readDevicePairingRequired(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DEVICE_PAIRING_REQUIRED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Sevk için ayrı "ambar aldı / çıkış" onay adımı zorunlu mu? Default false (kapalı).
 * Kapalıyken mobil ① "Sevkiyat" ekranı "Hemen Sevk Et" kısayolunu gösterir (paketleyen
 * direkt sevk eder); açıkken ① sadece "Sevke Hazır" yapar ve çıkış ② "Sevk Çıkışı"
 * ekranından onaylanır. Sadece UI rehberi — backend ENFORCE ETMEZ (her iki yoldan da
 * dispatch kabul edilir; ara depoda bekleme + sonradan çıkış flag'den bağımsız her zaman var).
 */
export async function readShipmentConfirmationEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Tambur'da çıkan top metresi kayıtlı (giriş) metreyi aşabilsin mi? Default TRUE (açık).
 * Açıkken operatör (tambur asıl ölçüm noktası olduğu için) kayıtlıdan fazla ölçtüğünde
 * kabul edilir — aşımda parent top tamamen tüketilir (currentQty=0), negatif kalan oluşmaz.
 * Admin kapatırsa tambur kesim/finalize'de çıkış > giriş ise 400 ile reddedilir. Diğer
 * flag'lerin aksine backend ENFORCE eder: tambur guard'ları (finalize / cutOpenFabric /
 * cutWarehouseRoll) yalnız aşım anında okur.
 */
export async function readTamburOverQuantityEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TAMBUR_OVER_QUANTITY_ENABLED },
    select: { value: true },
  });
  // Default AÇIK: kayıt yoksa true döner. Admin açıkça kapatırsa (value=false)
  // asBoolean false verir → guard'lar tekrar aşımı reddeder.
  if (!setting) return true;
  return asBoolean(setting.value);
}

/**
 * Refakat kartı marka/içerik ayarını okur (yoksa/eksikse default'lara düşer).
 * buildSnapshot bunu çağırıp config'i karta dondurur.
 */
export async function readTravelerCardConfig(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<TravelerCardConfig> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TRAVELER_CARD_CONFIG },
    select: { value: true },
  });
  const v = setting?.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return DEFAULT_TRAVELER_CARD_CONFIG;
  }
  return normalizeTravelerCardConfig(v as Record<string, unknown>);
}

/**
 * Belge künyesini okur (yoksa boş künye). irsaliye/çeki üst bloğunda firma adının
 * altına basılır.
 */
export async function readCompanyLetterhead(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<CompanyLetterhead> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.COMPANY_LETTERHEAD },
    select: { value: true },
  });
  const v = setting?.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return DEFAULT_COMPANY_LETTERHEAD;
  }
  const o = v as Record<string, unknown>;
  return {
    addressLine: typeof o.addressLine === "string" ? o.addressLine : "",
    phone: typeof o.phone === "string" ? o.phone : "",
    taxInfo: typeof o.taxInfo === "string" ? o.taxInfo : "",
  };
}

/**
 * Yazdırılan belge içerik ayarını HAM okur (yoksa boş map). Çözüm (varsayılanlarla
 * birleştirme) client tarafında resolveDocConfig ile yapılır — backend yalnız saklar.
 */
export async function readDocumentsConfig(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<DocumentsConfig> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DOCUMENTS_CONFIG },
    select: { value: true },
  });
  const v = setting?.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return sanitizeDocumentsConfig(v as Record<string, unknown>);
}

/**
 * Belge ayar map'ini güvenli tipe indirger: bilinmeyen alanları atar, tip uymayan
 * değerleri yok sayar. Saklamadan önce ve okuduktan sonra uygulanır.
 */
function sanitizeDocumentsConfig(raw: Record<string, unknown>): DocumentsConfig {
  const out: DocumentsConfig = {};
  for (const [docKey, val] of Object.entries(raw)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const o = val as Record<string, unknown>;
    const cfg: DocumentConfig = {};
    if (typeof o.titleOverride === "string") {
      cfg.titleOverride = o.titleOverride.trim().slice(0, 80);
    }
    if (typeof o.showLetterhead === "boolean") cfg.showLetterhead = o.showLetterhead;
    if (typeof o.showSignatures === "boolean") cfg.showSignatures = o.showSignatures;
    if (typeof o.footerNote === "string") {
      cfg.footerNote = o.footerNote.trim().slice(0, 500);
    }
    if (o.sections && typeof o.sections === "object" && !Array.isArray(o.sections)) {
      const sections: Record<string, boolean> = {};
      for (const [sk, sv] of Object.entries(o.sections as Record<string, unknown>)) {
        if (typeof sv === "boolean") sections[sk] = sv;
      }
      cfg.sections = sections;
    }
    if (Array.isArray(o.signatureLabels)) {
      cfg.signatureLabels = o.signatureLabels
        .filter((x): x is string => typeof x === "string")
        .slice(0, 6)
        .map((x) => x.trim().slice(0, 40));
    }
    out[docKey] = cfg;
  }
  return out;
}

/**
 * ERP'nin kurulduğu firmanın adını okur (yoksa/boşsa default'a düşer). Panel
 * marka başlığı + uygulama geneli kullanır. Refakat kartının kendi firma adından
 * bağımsızdır (kart snapshot'ı ayrı saklanır, geçmiş kartlar değişmez).
 */
export async function readCompanyName(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<string> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.COMPANY_NAME },
    select: { value: true },
  });
  const v = setting?.value;
  return typeof v === "string" && v.trim() ? v : DEFAULT_COMPANY_NAME;
}

/**
 * Pozitif tamsayı setting okuyucu — yoksa veya geçersizse default döner.
 * 0/negatif/NaN/Infinity → default. Float verilirse Math.floor uygulanır.
 */
async function readPositiveIntSetting(
  key: string,
  fallback: number,
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key },
    select: { value: true },
  });
  if (!setting) return fallback;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 1) return fallback;
  return Math.floor(parsed);
}

/**
 * Sipariş termini default gün sayısı. Order.create'de deadline verilmediyse
 * orderDate + N gün hesaplanır. Yoksa/geçersizse 7.
 */
export async function readOrderDefaultDeadlineDays(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  return readPositiveIntSetting(
    SETTING_KEYS.ORDER_DEFAULT_DEADLINE_DAYS,
    DEFAULT_DEADLINE_DAYS,
    tx,
  );
}

/**
 * İş emri planlama default süresi (gün). WorkOrder.create/update'de
 * plannedEndDate verilmediyse plannedStartDate + N gün hesaplanır.
 * Yoksa/geçersizse 7.
 */
export async function readWorkOrderDefaultPlanDurationDays(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  return readPositiveIntSetting(
    SETTING_KEYS.WORKORDER_DEFAULT_PLAN_DURATION_DAYS,
    DEFAULT_DEADLINE_DAYS,
    tx,
  );
}

/**
 * Oturum (JWT) ömrünü SAAT olarak okur. Yoksa/geçersizse 8 (eski sabit davranış).
 * 1 saatin altı → default; tavanı MAX_SESSION_DURATION_HOURS'a (30 gün) kırpılır.
 * AuthService.login bunu okuyup jwt.sign expiresIn'e (saniye) çevirir.
 */
export async function readSessionDurationHours(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_SESSION_DURATION_HOURS },
    select: { value: true },
  });
  if (!setting) return DEFAULT_SESSION_DURATION_HOURS;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 1) return DEFAULT_SESSION_DURATION_HOURS;
  return Math.min(Math.floor(parsed), MAX_SESSION_DURATION_HOURS);
}

/**
 * Hareketsizlik zaman aşımını DAKİKA olarak okur. Yoksa/geçersizse 0 (kapalı).
 * 0 = kapalı (otomatik çıkış yok); tavanı MAX_IDLE_TIMEOUT_MINUTES'a (24 saat) kırpılır.
 * Frontend (Electron AppShell) bunu okuyup idle logout sayacını kurar — backend
 * token'ı yine kendi mutlak ömrüne kadar geçerli kalır (idle salt UI tarafı).
 */
export async function readIdleTimeoutMinutes(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_IDLE_TIMEOUT_MINUTES },
    select: { value: true },
  });
  if (!setting) return DEFAULT_IDLE_TIMEOUT_MINUTES;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 0) return DEFAULT_IDLE_TIMEOUT_MINUTES;
  return Math.min(Math.floor(parsed), MAX_IDLE_TIMEOUT_MINUTES);
}
/**
 * Çalışma oturumu (WorkSession) hareketsizlik zaman aşımını DAKİKA olarak okur.
 * Yoksa/geçersizse 600 (10 saat); 0 = kapalı; tavan 1440. Backend TEMBEL enforce
 * eder — timer/cron yok: resolveActiveSession / sweepIdleSessions okuma anında
 * süresi dolan oturumu IDLE ile kapatır (work-session.helper.ts).
 */
export async function readWorkSessionIdleTimeoutMinutes(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.WORK_SESSION_IDLE_TIMEOUT_MINUTES },
    select: { value: true },
  });
  if (!setting) return DEFAULT_WORK_SESSION_IDLE_MINUTES;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 0) return DEFAULT_WORK_SESSION_IDLE_MINUTES;
  return Math.min(Math.floor(parsed), MAX_WORK_SESSION_IDLE_MINUTES);
}

/**
 * Mobil giriş yöntemlerini okur: { enabled, primary }. Backend ENFORCE eder —
 * login-card yalnız "card", login-quick-pin yalnız "pin" etkinken çalışır
 * (kapalıyken ilgili altyapı saldırı yüzeyi açmaz); klasik /auth/login HEP açık.
 * GERİYE-UYUM: yeni key yoksa eski auth.loginMode'dan türetilir
 * ("card" → kart öncelikli + liste yedek; "pin"/yok → yalnız liste).
 */
export async function readLoginMethods(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<LoginMethodsConfig> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_LOGIN_METHODS },
    select: { value: true },
  });
  const v = setting?.value as { enabled?: unknown; primary?: unknown } | null | undefined;
  if (v && typeof v === "object" && Array.isArray(v.enabled)) {
    const enabled = v.enabled.filter((m): m is LoginMethod =>
      LOGIN_METHODS.includes(m as LoginMethod),
    );
    if (enabled.length > 0) {
      const primary =
        typeof v.primary === "string" && enabled.includes(v.primary as LoginMethod)
          ? (v.primary as LoginMethod)
          : enabled[0];
      return { enabled: Array.from(new Set(enabled)), primary };
    }
  }
  // Geriye-uyum: eski tekil mod (Faz 5 ilk hali).
  const legacy = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_LOGIN_MODE },
    select: { value: true },
  });
  if (legacy?.value === "card") return { enabled: ["card", "list"], primary: "card" };
  return DEFAULT_LOGIN_METHODS;
}

/**
 * Saha #6: top etiketi kopya adedi (default 2 — topun üstüne + altına).
 * 1-5 aralığına kırpılır; geçersiz/yok → 2.
 */
export const DEFAULT_LABEL_COPIES = 2;
export async function readLabelCopies(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.LABEL_COPIES },
    select: { value: true },
  });
  if (!setting) return DEFAULT_LABEL_COPIES;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 1) return DEFAULT_LABEL_COPIES;
  return Math.min(Math.floor(parsed), 5);
}

/**
 * Saha #20: top adı (birleşik ürün tanımı) format şablonu. Token'lar:
 * {item} {color} {width} {quality}. Yoksa/boşsa default. Maks 100 karakter.
 */
export const DEFAULT_ROLL_NAME_TEMPLATE = "{item} {color} {width}";
export async function readRollNameTemplate(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<string> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.ROLL_NAME_TEMPLATE },
    select: { value: true },
  });
  const v = setting?.value;
  return typeof v === "string" && v.trim() ? v.slice(0, 100) : DEFAULT_ROLL_NAME_TEMPLATE;
}

/**
 * Varsayılan etiket yazıcı dili — native render (PPLA/PPLB/ZPL) veya HTML.
 * Default PPLA. Yazıcı modeli kendi dilini belirtirse o istasyonda model önceliklidir;
 * bu ayar model bağlamı yoksa (Electron/fallback) ve genel varsayılan olarak okunur.
 */
export const PRINTER_LANGUAGES: PrinterLanguage[] = ["RASTER_HTML", "PPLA", "PPLB", "ZPL"];
export const DEFAULT_PRINTER_LANGUAGE: PrinterLanguage = "PPLA";
export async function readPrinterLanguage(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<PrinterLanguage> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.LABEL_PRINTER_LANGUAGE },
    select: { value: true },
  });
  const v = setting?.value;
  return typeof v === "string" && PRINTER_LANGUAGES.includes(v as PrinterLanguage)
    ? (v as PrinterLanguage)
    : DEFAULT_PRINTER_LANGUAGE;
}

/**
 * Faz-2 opt-in: native etiket komutları yazıcıya doğrudan (RAW TCP 9100) gönderilsin mi.
 * Default false (Faz-1 simülasyon — hiç socket açılmaz). Açıkken printer-transport
 * gerçek gönderim yapar; ENFORCE edilir.
 */
export async function readLabelNativeSendEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.LABEL_NATIVE_SEND_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}


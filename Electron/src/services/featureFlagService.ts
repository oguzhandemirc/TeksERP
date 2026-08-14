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
/** Hücre kalınlığı — 2026-08-05'te medium/black eklendi (panel beş kademe). */
export type TravelerCardCellWeight = TravelerCardFontWeight | "medium" | "black";
/**
 * Tek tablo hücresi — göster + boyut + kalınlık (hücre-başına bağımsız).
 *
 * ⚠️ İKİ BOYUT ALANI VAR ve bu kalıcıdır: `px` yeni (sayısal punto, panel yalnız
 * bunu yazar), `size` eski kademe — donmuş snapshot'lar onu taşıdığı için
 * OKUNMAYA devam eder ve silinemez. Backend aynası: `system-setting.service.ts`.
 */
export interface TravelerCardSpecField {
  show: boolean;
  size: TravelerCardFieldSize;
  weight: TravelerCardCellWeight;
  /** Sayısal punto (5–48). Verilmezse `size` kademesi, o da yoksa profil tabanı. */
  px?: number;
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
/**
 * Partiler tablosu sütunları — her biri tek tek. İÇERİK baskı anında canlı
 * çözülür (kart iş emri açılışında donar, parti sonra doğar); burada yalnız
 * GÖRÜNÜM kararı yaşar. Backend aynası: `system-setting.service.ts`.
 */
export interface TravelerCardBatchFields {
  batchNumber: TravelerCardSpecField;
  rollCount: TravelerCardSpecField;
  quantity: TravelerCardSpecField;
  dispatch: TravelerCardSpecField;
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
  /** Bağlı siparişler tablosu sütunları (Sipariş No/Müşteri/Kumaş/Renk/Miktar). */
  orderFields: TravelerCardOrderFields;
  /** Miktar toplamı satırı — göster/boyut/kalınlık (show=false → basılmaz). */
  orderTotal: TravelerCardSpecField;
  /** Partiler tablosu basılsın mı (iş emrinin partisi yoksa zaten basılmaz). */
  showBatches: boolean;
  /** Partiler tablosu sütunları (Parti No/Top/Metraj/Sevk). */
  batchFields: TravelerCardBatchFields;
  /** Parti toplamı satırı — göster/boyut/kalınlık (show=false → basılmaz). */
  batchTotal: TravelerCardSpecField;
  /**
   * ALAN BAZLI yazı ayarı — `key → { size?: px, weight? }`. Anahtar kataloğu
   * `pages/GeneralSettings/travelerCardFields.ts` (backend
   * `document-render/traveler-card.fields.ts`'in aynası; Electron backend'i
   * import edemez, ikisi birlikte güncellenir).
   *
   * `specFields`/`orderFields`/`batchFields` ile ÇAKIŞMAZ, KATMANLIDIR: onlar
   * hücre-başına sm/lg kademesidir; buradaki `specValue`/`orderCell`/`batchCell`
   * o kademelerin TABANINI belirler ve renderer kademeleri tabana oranlar.
   *
   * ⚠️ Verilmezse renderer tek bayt ek CSS basmaz (bugünkü çıktı korunur), bu
   * yüzden boş nesne GÖNDERİLMEZ — panel `undefined` bırakır.
   */
  fields?: Record<string, TravelerCardFieldStyle>;
  /**
   * BOŞ TABLO (2026-08-13) — kartın alt boşluğuna elle doldurulan ızgara
   * (kurşun kaydı vb.). Şekil BELGELERLE ORTAK (`documentConfig.BlankGridConfig`)
   * çünkü backend'de de tip/sanitize/renderer ortak; panelde de AYNI bileşen
   * (`BlankGridPanel`) kullanılır — iki farklı grid ayarı yüzeyi doğmasın.
   */
  blankGrid?: TravelerCardBlankGrid;
  /** Kart altına basılan serbest not (boş → basılmaz). */
  footerNote: string;
}

/** Belgelerdeki `BlankGridConfig` ile BİREBİR (backend `doc-style.ts`). */
export interface TravelerCardBlankGrid {
  enabled?: boolean;
  title?: string;
  rows?: number;
  columns?: number;
  columnWidths?: number[];
  headers?: string[];
  position?: "afterHeader" | "beforeSignatures";
}

/** Alan bazlı görünürlük + yazı ayarı — sayısal punto + beş kademeli kalınlık. */
export type TravelerCardFieldWeight = "light" | "normal" | "medium" | "bold" | "black";
export interface TravelerCardFieldStyle {
  /** Yazı boyu px. Verilmezse alanın yoğunluk profilindeki tabanı geçerlidir. */
  size?: number;
  /** Yazı kalınlığı. Verilmezse alanın taban kalınlığı geçerlidir. */
  weight?: TravelerCardFieldWeight;
  /** true → alan basılmaz. `false` YAZILMAZ (varsayılan zaten görünür). */
  hidden?: boolean;
}
/** Backend `doc-style.ts` ile AYNI sınırlar — panel de aynı sınırı göstermeli. */
export const TRAVELER_FIELD_SIZE_MIN = 5;
export const TRAVELER_FIELD_SIZE_MAX = 48;

export const DEFAULT_TRAVELER_CARD_CONFIG: TravelerCardConfig = {
  companyName: "Adnan Şahin Tekstil",
  addressLine: "",
  phone: "",
  // Backend `DEFAULT_TRAVELER_CARD_CONFIG` ile aynı olmalı — kart varsayılan A5.
  pageSize: "A5",
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
  showBatches: true,
  batchFields: {
    batchNumber: { show: true, size: "md", weight: "normal" },
    rollCount: { show: true, size: "md", weight: "normal" },
    quantity: { show: true, size: "md", weight: "normal" },
    dispatch: { show: true, size: "md", weight: "normal" },
  },
  batchTotal: { show: true, size: "md", weight: "bold" },
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
  /** Ön muhasebe modülü (cari · fatura · tahsilat · kasa/banka). Varsayılan
   *  KAPALI — kapalıyken menüde tek satır bile çizilmez ve route 403 verir.
   *  ⚠️ `pricingEnabled` ile bağımsız: o OPERASYON ekranlarındaki fiyat
   *  alanlarını açar, bu ayrı bir MUHASEBE modülünü açar. */
  financeEnabled: boolean;
  /** KASA eksi bakiyeye düşemesin (default false). Backend ENFORCE: 4 ileri yol
   *  409 (ödeme OUT · masraf fişi · virmanın çıkan kasa bacağı · çek ödeme);
   *  BANKA MUAF (kredili mevduat meşru), iptal/storno yolları MUAF. */
  financeBlockNegativeCashEnabled: boolean;
  /** Fatura satırının varsayılan KDV oranı, % (0–100; default 20). Yalnız
   *  ÖN-DOLUM — fatura formunun yeni satırı ve mal kabulden üretilen alış
   *  taslağı bu değerle açılır; satırda değiştirilebilir. */
  financeDefaultVatRate: number;
  // --- TİCARET/MUHASEBE REJİM ANAHTARLARI (2026-08-14, dalga 1) --------------
  // ⚠️ Dokuzu da default FALSE ve backend'de bugün HİÇBİR servis okumuyor
  // (bilinçli ara durum): dört kapı önce kurulur, guard/otomasyon sonraki
  // dalgada bağlanır. Panelde toggle'lar görünür ve kaydedilir; davranış
  // değişikliği YOKTUR. Açıklama metinleri `settings-config.ts`te.
  /** Cari risk limiti aşımında SATIŞ faturası onayını engelle (default false).
   *  Bugün limit yalnız uyarıdır; açıkken onay 409 döner. MUAF: alış faturası,
   *  taslak yolları, iptal/storno. */
  financeRiskLimitBlockEnabled: boolean;
  /** Sevk onayında otomatik satış faturası TASLAĞI üret (default false). Onay
   *  her zaman elle kalır; ön muhasebe kapalıyken kanca no-op'tur. */
  financeAutoDraftFromShipmentEnabled: boolean;
  /** Tahsilat/ödemede en eski açık faturalara otomatik FIFO kapama (default
   *  false). Artan tutar avans olarak açıkta kalır; tahsis elle silinebilir. */
  financeAutoAllocateOnPaymentEnabled: boolean;
  /** İplik çıkışında eksi bakiyeye düşecek hareketi engelle (default false).
   *  Kasa emsali. MUAF: ters/düzeltme kayıtları ve belge iptali. */
  yarnBlockNegativeBalanceEnabled: boolean;
  /** Alış siparişine bağlı mal kabulde sipariş miktarını aşan satırı engelle
   *  (default false = fazla mal kaydedilir, sistem uyarır). */
  purchaseBlockOverReceiptEnabled: boolean;
  /** Mal kabul satırında birim fiyat zorunlu (default false; çözülemezse 400). */
  goodsReceiptRequirePriceEnabled: boolean;
  /** Sıfır fiyatlı fatura satırıyla onaya izin ver (default false). İzin
   *  verilen SIFIRDIR, boş fiyat değil; negatif fiyat her hâlükârda reddedilir. */
  financeAllowZeroPriceLineEnabled: boolean;
  /** İleri tarihli mali belge tarihini engelle (default false). Sınır FABRİKA
   *  günüdür. MUAF: çekin keşide ve vade tarihi (ileri tarihli çek normaldir). */
  financeFutureDatedDocumentBlockEnabled: boolean;
  /** Satış faturası onayında iplik satırlarını varsayılan depodan stoktan düş
   *  (default false = stok yalnız sevkte düşer). ⚠️ Sevkten de düşen kurulumda
   *  açmak ÇİFTE DÜŞÜM olur — rejim sorusudur, ek güvence değil. */
  financeYarnOutOnInvoiceEnabled: boolean;
  /** Üretim modülü — envanter üretim sekmeleri + iş emri yüzeyleri. Varsayılan AÇIK. */
  productionEnabled: boolean;
  targetQuantityEnabled: boolean;
  rawWidthEnabled: boolean;
  /** KK1 ham kumaş girişinde ağırlık (kg) alanı — default false; backend ENFORCE eder. */
  kk1WeightEntryEnabled: boolean;
  kk1DuplicateGuardEnabled: boolean;
  /** KK1 ham giriş çevrimdışı kuyruksuz (online-only) rejimde mi — default false;
   *  mobil ENFORCE eder (açıkken KK1 çevrimdışı kayıt almaz, kayıt+etiket tek nefeste). */
  kk1OnlineOnlyEnabled: boolean;
  /** KK1 etiket geri-okutma doğrulaması (scan-back) — default false; mobil ENFORCE
   *  eder (açıkken basılan etiket okutulmadan yeni top girilemez). */
  kk1LabelScanVerifyEnabled: boolean;
  /** KK1 "Tüm Girişler" tüm operatörlerin kayıtlarını göstersin — default false;
   *  mobil ENFORCE eder (kapalıyken operatör yalnız kendi girdiği topları görür). */
  kk1HistoryAllEntriesEnabled: boolean;
  /** Simüle kantardan gelen çuval tartısı kaydedilebilsin mi — default false;
   *  backend ENFORCE eder (kapalıyken simüle okuma 400). Yalnız demo/eğitim. */
  shippingSimulatedWeightEnabled: boolean;
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
  /** Sevk geri alma (storno) yalnız aynı fabrika gününde mi yapılabilsin (false=default,
   *  yani tarih sınırı YOK). Faturalanmış ve iade alınmış sevkiyat koşulları bu ayardan
   *  BAĞIMSIZ, her zaman geçerlidir — bu yalnız ek bir daraltma. Backend ENFORCE eder. */
  shipmentUndoSameDayOnly: boolean;
  /** Müşteri şubeleri (sevk noktaları) UI'da açık mı (true=default). Kapalıyken müşteri
   *  formundaki Şubeler sekmesi/taslağı ve sipariş formundaki şube seçimi gizlenir.
   *  Salt UI rehberi — mevcut kayıtlardaki branchId verisi korunur. */
  customerBranchesEnabled: boolean;
  /** Tambur'da çıkan top metresi kayıtlı (giriş) metreyi aşabilsin mi (true=default/açık).
   *  Açıkken operatör kayıtlıdan fazla ölçtüğünde (örn. 100m açık kumaşı 150m top yapma)
   *  onay sonrası kabul edilir; kaynak top tamamen tüketilir. Backend ENFORCE eder. */
  tamburOverQuantityEnabled: boolean;
  /** Tambur "TÜMDEN geri al" yalnız AYNI FABRİKA GÜNÜ içinde yapılabilsin mi
   *  (false=default, sınır YOK). Asıl koruma parçaların kendisindedir (çuvala
   *  okutulmuş / sevke girmiş / yeniden kesilmiş parça zaten reddedilir); sert
   *  bir süre sınırı dün akşamki hatayı sabah düzeltmeyi imkânsız kılabilir.
   *  TEK PARÇA iptali bu ayardan ETKİLENMEZ. Emsal: shipping.undoDispatchSameDayOnly. */
  tamburUndoFullSameDayOnly: boolean;
  /** Kurşun bypass düzeni açık mı (false=default). Kurşun makinelerinde tablet YOK:
   *  iş fiziksel olarak yapılır ama dijital izlenmez; yetkili "Kurşun Dağıtım"
   *  ekranından işi fiziksel bir kurşun MAKİNESİNE atar (istasyon değil — PROCESS_QC
   *  türünde tek istasyon vardır, altındaki makinelerden biri seçilir), Tambur kartı
   *  okutunca kurşun adımı SESSİZCE tamamlanır (operatör onayı yok).
   *  Açıkken "Kurşun Sırası" ekranı gizlenir (karo + route). Backend YALNIZ YENİ ATAMA
   *  oluşturmayı kapılar — dağıtılmış iş emirleri bayrak kapansa da bypass ile
   *  bitirilir (rejim atama satırında kalıcıdır). */
  kursunBypassEnabled: boolean;
  /** Parti no KISA ve DÖNEN mi (P01…P99, 99'dan sonra P01)? Default TRUE/AÇIK.
   *  Backend ENFORCE eder (`generateBatchNumberTx`). Kapalıyken eski
   *  `P + GGAAYY + günlük sıra` kalıbına düşülür.
   *  ⚠️ Açıkken parti no BENZERSİZ DEĞİLDİR — numara birkaç günde bir yeniden
   *  kullanılır (fabrika numaralı fiziksel parti plakası kullanıyor). Partinin
   *  kimliği `id`'dir; hiçbir yerde `batchNumber` ile eşleştirme yapma. */
  batchShortNumberEnabled: boolean;
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
  /** Otomatik gece yedeğinin saati (0-23, SUNUCUNUN yerel saati; default 3).
   *  Backend ENFORCE eder — zamanlayıcı her turda okur, değişiklik için sunucuyu
   *  yeniden başlatmak GEREKMEZ (en geç 15 dk içinde geçerli olur). */
  backupHour: number;
}

export { DEFAULT_COMPANY_LETTERHEAD };

/**
 * Kısa parti sayacının anlık durumu (`GET /api/batches/number-state`).
 * Bayrak kapalıyken `enabled:false` gelir ve numara alanları `null`'dır.
 */
export interface BatchNumberState {
  enabled: boolean;
  min: number;
  max: number;
  /** En son kullanılan numara; hiç kısa parti doğmadıysa null. */
  last: number | null;
  /** Sıradaki numara — ÖNİZLEME, rezervasyon değil. */
  next: number | null;
  lastCode: string | null;
  nextCode: string | null;
}

export const featureFlagService = {
  get: (): Promise<ApiResponse<FeatureFlags>> =>
    apiClient.get<ApiResponse<FeatureFlags>>("/api/feature-flags").then((r) => r.data),

  update: (flags: Partial<FeatureFlags>): Promise<ApiResponse<FeatureFlags>> =>
    apiClient
      .patch<ApiResponse<FeatureFlags>>("/api/feature-flags", flags)
      .then((r) => r.data),

  /**
   * Kısa parti sayacının durumu — Genel Ayarlar'daki göstergeyi besler.
   *
   * FeatureFlags'ten AYRI uç: bu bir ayar değil türetilmiş bir DEĞER (canlı veriden
   * okunur) ve her uygulama açılışında ödenmesi gereksiz bir sorgu olurdu.
   *
   * ⚠️ `next` ÖNİZLEMEDİR, rezervasyon DEĞİL — arada bir parti doğarsa gerçekleşen
   * numara farklı olur. Yüzey bunu "sıradaki" der, "ayrılmış" demez.
   */
  getBatchNumberState: (): Promise<ApiResponse<BatchNumberState>> =>
    apiClient
      .get<ApiResponse<BatchNumberState>>("/api/batches/number-state")
      .then((r) => r.data),

  /** Güncel belge logosu (data-url; yoksa null). FeatureFlags'ten ayrı uç —
   *  base64 app-start yükünü şişirmesin diye yalnız ihtiyaç anında çekilir. */
  getDocumentsLogo: (): Promise<ApiResponse<{ dataUrl: string | null }>> =>
    apiClient
      .get<ApiResponse<{ dataUrl: string | null }>>("/api/feature-flags/documents-logo")
      .then((r) => r.data),

  /** Belge logosunu güncelle (dataUrl=null → kaldır). PNG/JPEG/SVG, ~100KB sınırı. */
  setDocumentsLogo: (dataUrl: string | null): Promise<ApiResponse<{ dataUrl: string | null }>> =>
    apiClient
      .put<ApiResponse<{ dataUrl: string | null }>>("/api/feature-flags/documents-logo", { dataUrl })
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

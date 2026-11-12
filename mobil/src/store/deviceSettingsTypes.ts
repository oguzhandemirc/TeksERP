// Cihaz ayarları deposunun tipleri ve saf çözücüleri — dosya boyu tavanı için depodan ayrıldı;
// deviceSettingsStore yeniden ihraç eder (çağıranlar değişmez).
import type { HardwareLink, ScanMethodPref } from '../services/hardwareScanner/resolveScanMethod';
import type { WoCreateKind } from './woCreateKinds';
import type { DocIncomingField } from './docIncomingFields';

export type WoButtons = 'both' | 'scan' | 'manual';


/** Metraj kaynağı: makineden oku (auto) ya da operatör elle girsin (manual). */
export type MeterEntryMode = 'manual' | 'auto';

/** Baskı kâğıdı boyu. */
export type DocPageSize = 'A4' | 'A5';

/** Barkod/QR okuyucunun kamera yönü. */
export type CameraFacing = 'front' | 'back';

/** Belge masası çekim kipi (K26): dokunarak (varsayılan) | otomatik (deneysel). */
export type DocDeskCaptureMode = 'tap' | 'auto';

/** Belge okutma çekimi: kendi çok çekimli kameramız (varsayılan) | Google ML Kit belge tarayıcısı (yedek) | canlı okuma. */
export type DocScanEngine = 'camera' | 'mlkit' | 'live';

/** Yalnız birebir 'mlkit' / 'live' seçer; kayıt yok / bozuk → kendi kameramız. */
export function parseDocScanEngine(raw: string | null): DocScanEngine {
  return raw === 'mlkit' || raw === 'live' ? raw : 'camera';
}

/** Kayıtlı 'live' ama canlı kamera modülü yok (eski APK) → bugünkü kendi kameramız. */
export function effectiveScanEngine(engine: DocScanEngine, liveAvailable: boolean): DocScanEngine {
  return engine === 'live' && !liveAvailable ? 'camera' : engine;
}

/** "Flaşı otomatik aç" varsayılanı: belge kameraları feneri yakarak açılır (kağıt gölgesiz, OCR netliği). */
export const DOC_TORCH_AUTO_DEFAULT = true;

/** Yalnız birebir 'true'/'false' kayıt varsayılanı değiştirir; kayıt yok / bozuk → varsayılan. */
export function parseDocTorchAuto(raw: string | null): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return DOC_TORCH_AUTO_DEFAULT;
}

/** Otomatik çekim ara kare aralığı seçenekleri (ms) — pil/ısı için seyrekleştirilebilir. */
export const DOC_DESK_FRAME_MS_OPTIONS = [500, 700, 1000, 1500] as const;
export const DOC_DESK_FRAME_MS_DEFAULT = 700;

/** Bilinmeyen/bozuk kayıt → varsayılan aralık. */
export function parseDocDeskFrameMs(raw: string | null): number {
  const n = raw == null ? NaN : Number(raw);
  return (DOC_DESK_FRAME_MS_OPTIONS as readonly number[]).includes(n) ? n : DOC_DESK_FRAME_MS_DEFAULT;
}

/** Kısa kesim kuralının bu cihazdaki kaynağı — bkz. `tamburShortCutA1Override`. */
export type ShortCutOverrideMode = 'server' | 'on' | 'off';

export interface DeviceSettingsState {
  /** true → barkod ekranlarında manuel giriş input'ları görünür. Default false:
   *  operatör sadece kamerayı kullanır, ekran daha minimal. Kamera arızalıysa
   *  Ayarlar'dan açılır. (Hızlı İş Emri bunu "bu cihazda kamera kullanılamıyor"
   *  sinyali sayar ve "Listeden Ekle" butonunu görünür kılar.) */
  manualBarcodeEntry: boolean;
  /** Hızlı İş Emri'nde son kullanılan rota şablonu — yeni form açılışında otomatik
   *  seçili gelir (saha genelde aynı rotayı kullanır). null = yok. */
  lastRouteTemplateId: string | null;
  /** KK1 "Manuel Giriş": true → mt/kg elle girilir, false → makineden okunur.
   *  CİHAZDA kalıcı — operatör her girişte tercihini yeniden yapmasın (metre
   *  makinesi arızalı bir istasyonda vardiya boyunca manuel kalır). */
  kk1ManualEntry: boolean;
  /** Tambur kesim metrajı: elle mi, makineden mi. Ana kesim ve "Top Kesme"
   *  AYNI tercihi paylaşır (bilinçli): seçim aslında "bu istasyonda metre
   *  makinesi çalışıyor mu" gerçeğini yansıtır, o da tek bir gerçektir. */
  tamburCutMode: MeterEntryMode;
  /** Tambur kesim kg'si: elle mi, Kes anında tartıdan mı (2026-11-10). Varsayılan 'manual' = bugünkü davranış. */
  tamburKgMode: MeterEntryMode;
  /**
   * Tambur kesiminde bir çıktı alındıktan sonra KALİTE sıfırlansın mı?
   *   true  → her kesimden sonra "1. Kalite"ye döner (yanlışlıkla A1 basılmasın).
   *   false → son seçilen kalite kalır (bugünkü davranış; seri A1 kesiminde hızlı).
   *
   * CİHAZDA tutulur, sunucuya gitmez: tercih "bu tamburda nasıl çalışıyoruz"
   * gerçeğine bağlı, kişiye değil (`tamburCutMode` ile aynı gerekçe).
   * Varsayılan FALSE — bugünkü davranışı sessizce değiştirmemek için.
   */
  tamburResetQualityAfterCut: boolean;
  /**
   * Tambur kesiminde bir çıktı alındıktan sonra KARTELALIK işareti sıfırlansın mı?
   *   true  → her kesimden sonra kapanır (varsayılan; yanlış işaret sınıfı kapanır).
   *   false → aynı kumaşın kesimleri arası açık kalır (seri kartela kesiminde hızlı).
   *
   * ⚠️ VARSAYILAN TRUE — kalite ikizinden (yukarıda) FARKLI kutup, bilerek.
   * Oradaki gerekçe "bugünkü davranışı sessizce değiştirme"ydi; burada bugünkü
   * davranış 2026-08-19'da sahada ISIRDI: 14:54'te bir kez açılan anahtar
   * F0118 + F0119 + F0120'yi (3 × 40 m) kartelalık işaretledi ve etikete
   * KARTELALIK bastı. Kartela kesimi NADİR (günde 1-2) ve parçalar KÜÇÜK (10 m);
   * yapışkan varsayılan yanlış kutuptu. Seri kartela kesen operatör her seferinde
   * bir kez dokunur — yanlış işaretlenmiş 40 m'lik topu geri almaktan ucuz.
   *
   * `tamburCutMode`/`tamburResetQualityAfterCut` ile aynı gerekçeyle CİHAZDA:
   * tercih "bu tamburda nasıl çalışıyoruz" gerçeğine bağlı, kişiye değil.
   */
  tamburResetKartelaAfterCut: boolean;
  /**
   * Operatörün Tambur'da EN SON elle bastığı kalite kodu (saha 2026-11-10): kesimden sonra, topa/karta
   * geçince ve uygulama yeniden açılınca seçili kalır. null = hatırlanan yok; katalogda yoksa ekran seçimsiz kalır.
   */
  tamburLastQualityCode: string | null;
  /** Liste sütun seçimi, EKRAN KİMLİĞİNE göre (ör. 'tambur.recentOutput'); kayıt yok = ekranın varsayılanı. */
  listColumns: Record<string, string[]>;
  /**
   * Tambur "MANUEL EKLE" modu: true → ekran refakat kartı BEKLEMEZ, operatör
   * ürün/metraj/müşteri seçip topu doğrudan BİTMİŞ DEPO'ya yazar
   * (`POST /tambur/manual/produce`). false → normal akış (kart okutulur).
   *
   * ACİL DURUM modudur (top bir yerde takıldı / elde kalan bitmiş mal acilen
   * sisteme alınacak), KK1 ham girişinin kopyası DEĞİL. `tamburCutMode` ile
   * aynı gerekçeyle CİHAZDA kalıcı: vardiya boyunca aynı istisna sürebilir ve
   * operatör her toppa anahtarı yeniden aramasın. Varsayılan KAPALI — mod
   * kart izini atlattığı için "unutulmuş açık anahtar" riski en aza insin diye
   * ekranda daima belirgin işaretlenir (bkz. TamburScreen manuel mod bandı).
   */
  tamburManualMode: boolean;
  /**
   * Okutma sesi (kabul / mükerrer / ret için ayrı tonlar). Varsayılan AÇIK —
   * endüstriyel okuyucunun evrensel onayı bip'tir ve eldivenli operatörde
   * titreşim zayıf kalır. Sessiz çalışması gereken yerler (ofis/gece vardiyası)
   * için kapatılabilir; kapatmak TİTREŞİMİ etkilemez, iki kanal ayrıdır.
   */
  scanSoundEnabled: boolean;
  /**
   * Belge baskısında son seçilen kâğıt boyu — **BELGE TİPİ BAŞINA**.
   *
   * Neden tipe göre: refakat kartı doğal olarak A5 (küçük kart), fason çeki ise
   * grid listesi ve A4 istiyor. TEK ortak hafıza bu ikisini birbirine ezdirir ve
   * operatör her baskıda anahtarı çevirmek zorunda kalırdı — `kk1ManualEntry`i
   * cihaza taşımamızın sebebi tam olarak buydu ("her girişte anahtar çevirme").
   *
   * ⚠️ CİHAZDA kalıcı, kullanıcıda DEĞİL: kâğıt boyu o istasyona bağlı YAZICININ
   * özelliğidir, operatörün tercihi değil. Vardiya değişince yazıcı değişmez.
   *
   * Kayıt YOKSA ilgili tip için `undefined` döner ve istemci hiçbir şey
   * göndermez → backend KALICI AYARI uygular (bugünkü davranış korunur).
   */
  docPageSize: Record<string, DocPageSize>;
  /**
   * Barkod tarayıcının açılacağı kamera yönü — **en son kullanılan** yön.
   *
   * Varsayılan 'back': barkod okumada endüstri varsayılanı arka kameradır
   * (odak mesafesi, çözünürlük ve fener orada). Ama sabit montajlı / ekranı
   * operatöre dönük duran tablette ön kamera kullanılıyor ve her tarayıcı
   * açılışında yönü elle çevirmek gerekiyordu.
   *
   * ⚠️ CİHAZDA kalıcı, kullanıcıda DEĞİL (`docPageSize` ile aynı gerekçe): yön
   * tabletin fiziksel DURUŞUNA bağlıdır, operatörün tercihine değil — vardiya
   * değişince tabletin montajı değişmez. Fener bilinçli olarak bunun DIŞINDA
   * kalır (oturum ömürlü): ışık ihtiyacı okutulan YERE bağlıdır, cihaza değil.
   */
  cameraFacing: CameraFacing;
  /**
   * Tambur KISA KESİM → OTOMATİK A1 — CİHAZ OVERRIDE'ı (2026-08-19).
   *
   * Kuralın kendisi `screens/Modules/Tambur/shortCutQuality.ts`te; bayrak+eşiğin
   * FABRİKA değeri sunucudadır (feature-flags). Burada yalnız "bu cihaz fabrika
   * ayarını mı izliyor, yoksa kendi kararını mı uyguluyor" yaşar:
   *   • 'server' (varsayılan) → fabrika ayarı geçerli
   *   • 'on'                  → bu cihazda AÇIK, eşik aşağıdaki cihaz değeri
   *   • 'off'                 → bu cihazda KAPALI (fabrika açık olsa da)
   *
   * ⚠️ ÜÇ DURUM ŞART: iki durumlu (boolean) bir modelde "girilmemiş" ile
   * "sunucuyu kullan" aynı değere düşerdi ve fabrika ayarı değiştiğinde cihazın
   * bunu izleyip izlemediği belirsiz kalırdı.
   *
   * Override kontrolleri yalnız SÜPERVİZÖRE çizilir (saha düzeltme yetkisi —
   * `WorkPreferencesScreen`); sıradan operatör fabrika ayarını salt-okunur görür.
   */
  tamburShortCutA1Override: ShortCutOverrideMode;
  /** 'on' modunda geçerli eşik (metre). null = girilmemiş → kural inert. */
  tamburShortCutA1DeviceThresholdM: number | null;
  /**
   * "Bu cihaz belge masası" (K23): açılışta İE oluştur ekranı doğrudan kamera-önce masa kipinde açılır.
   * CİHAZDA: sabit tablet/telefonun duruşuna bağlıdır. Varsayılan KAPALI = bugünkü açılış.
   */
  docDeskDevice: boolean;
  docDeskCaptureMode: DocDeskCaptureMode;
  docDeskFrameMs: number;
  /** Belge okut / tanıt çekimi (CİHAZDA: tarayıcının bu cihazda çalışıp çalışmadığı cihaza bağlı). */
  docScanEngine: DocScanEngine;
  /** Belge kameraları açılınca fener yansın mı (CİHAZDA: flaş ve masa ışığı cihaza/yere bağlı). Varsayılan AÇIK. */
  docTorchAuto: boolean;
  /** Belgeden İE formunda KAPALI gelen (beyan) alanları (CİHAZDA; `docIncomingFields`). Varsayılan boş = hepsi açık. */
  docHiddenIncoming: DocIncomingField[];
  /** İE oluştur türleri (Seçenekler; CİHAZDA). Varsayılan yalnız STANDARD = bugünkü davranış. */
  woCreateKinds: WoCreateKind[];
  /** "Rota seçimini Belge Okut tuşunda göster" (CİHAZDA). Varsayılan AÇIK = bugünkü rota seçici; kapalıyken saklı rota kullanılmaz. */
  woRouteOnButton: boolean;
  /** İş Emirleri alt tuşları (Seçenekler; CİHAZDA): ikisi ya da yalnız biri — ikisi birden kapanamaz. Varsayılan ikisi. */
  woButtons: WoButtons;
  /** "Son parti numarasını göster" (İE oluşturma başlığında; CİHAZDA). Varsayılan AÇIK. */
  woLastBatchHint: boolean;
  /**
   * Okutma yöntemi (el terminali, 2026-11-07): Otomatik (varsayılan) · Donanım okuyucu · Kamera. CİHAZDA:
   * okuyucunun varlığı cihaza bağlıdır. Otomatik okuyucusuz cihazda kameradır = bugünkü davranış.
   */
  scanMethod: ScanMethodPref;
  /** Donanım bağlantısı: Otomatik (tanınan okuyucu intent ile) · Klavye (yedek, wedge'e zorla). */
  hardwareLink: HardwareLink;
  isLoaded: boolean;

  init: () => Promise<void>;
  setManualBarcodeEntry: (v: boolean) => Promise<void>;
  setLastRouteTemplateId: (v: string | null) => Promise<void>;
  /** Tambur "Bu işten çıkanlar" paneli katlı mı. Cihazda kalıcı: manuel metre
   *  girişi açık istasyonda yer dar — operatör kapatır, her kartta yeniden
   *  kapatmak zorunda kalmaz (kk1ManualEntry ile aynı gerekçe). */
  tamburOutputCollapsed: boolean;
  setTamburOutputCollapsed: (v: boolean) => Promise<void>;
  setKk1ManualEntry: (v: boolean) => Promise<void>;
  setTamburCutMode: (v: MeterEntryMode) => Promise<void>;
  setTamburKgMode: (v: MeterEntryMode) => Promise<void>;
  setTamburResetQualityAfterCut: (v: boolean) => Promise<void>;
  setTamburLastQualityCode: (v: string | null) => Promise<void>;
  /** null → o ekranın kaydı silinir (varsayılana dön); diğer ekranlara dokunulmaz. */
  setListColumns: (screenKey: string, cols: string[] | null) => Promise<void>;
  setTamburResetKartelaAfterCut: (v: boolean) => Promise<void>;
  setTamburManualMode: (v: boolean) => Promise<void>;
  setScanSoundEnabled: (v: boolean) => Promise<void>;
  setDocPageSize: (docType: string, v: DocPageSize) => Promise<void>;
  setCameraFacing: (v: CameraFacing) => Promise<void>;
  setTamburShortCutA1Override: (v: ShortCutOverrideMode) => Promise<void>;
  setTamburShortCutA1DeviceThresholdM: (v: number | null) => Promise<void>;
  setDocDeskDevice: (v: boolean) => Promise<void>;
  setScanMethod: (v: ScanMethodPref) => Promise<void>;
  setHardwareLink: (v: HardwareLink) => Promise<void>;
  setDocDeskCaptureMode: (v: DocDeskCaptureMode) => Promise<void>;
  setDocDeskFrameMs: (v: number) => Promise<void>;
  setDocScanEngine: (v: DocScanEngine) => Promise<void>;
  setDocTorchAuto: (v: boolean) => Promise<void>;
  setWoCreateKinds: (v: WoCreateKind[]) => Promise<void>;
  setWoRouteOnButton: (v: boolean) => Promise<void>;
  setDocIncomingShown: (key: DocIncomingField, shown: boolean) => Promise<void>;
  setWoButtons: (v: WoButtons) => Promise<void>;
  setWoLastBatchHint: (v: boolean) => Promise<void>;
  /** Tercihi kaldır → o belge tipi yine SUNUCUDAKİ kalıcı ayarla basılır. */
  clearDocPageSize: (docType: string) => Promise<void>;
}

/**
 * Diskteki kâğıt boyu haritasını çözer.
 *
 * ⚠️ FAIL-SAFE: bozuk JSON, dizi, yabancı değer ("A3"/null/sayı) → o giriş
 * ATILIR, tüm harita çöpe gitmez. Baskı yolunu bozuk bir tercih kaydı yüzünden
 * düşürmek, kalıcı ayarla basmaktan çok daha kötüdür.
 */
export function parseDocPageSizes(raw: string | null): Record<string, DocPageSize> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, DocPageSize> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === 'A4' || v === 'A5') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Bozuk kayıt → {} (her ekran varsayılanına döner); yalnız string dizisi değerler kalır. */
export function parseListColumns(raw: string | null | undefined): Record<string, string[]> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string[]> = {};
    for (const [k, cols] of Object.entries(v as Record<string, unknown>)) {
      if (Array.isArray(cols) && cols.every((c) => typeof c === 'string')) out[k] = cols as string[];
    }
    return out;
  } catch {
    return {};
  }
}

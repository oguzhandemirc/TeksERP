import { create } from 'zustand';
import { storage } from '../utils/storage';

// =============================================================================
// Cihaz-bazlı operatör ayarları. Sunucudan bağımsız — kamera donanım sorunu
// kullanıcıyla değil cihazla ilgili. Operatör değişse bile flag korunur.
// =============================================================================

const MANUAL_BARCODE_KEY = 'device_manual_barcode_entry';
const LAST_ROUTE_KEY = 'device_quick_wo_last_route';
const KK1_MANUAL_METER_KEY = 'device_kk1_manual_meter';
const TAMBUR_RESET_QUALITY_KEY = 'tambur_reset_quality_after_cut';
const TAMBUR_RESET_KARTELA_KEY = 'tambur_reset_kartela_after_cut';
const TAMBUR_CUT_MODE_KEY = 'device_tambur_cut_mode';
const TAMBUR_MANUAL_MODE_KEY = 'device_tambur_manual_mode';
const TAMBUR_OUTPUT_COLLAPSED_KEY = 'tambur_output_collapsed';
const SCAN_SOUND_KEY = 'device_scan_sound';
const DOC_PAGE_SIZE_KEY = 'device_doc_page_size';
const CAMERA_FACING_KEY = 'device_camera_facing';
// ⚠️ 2026-08-19: kısa kesim ayarı MERKEZE taşındı (feature-flags). Cihazda artık
// "bayrak + eşik" değil, ÜÇ DURUMLU override yaşar. Eski anahtarlar
// (`tambur_short_cut_a1_enabled` / `..._threshold`) sahaya HİÇ ÇIKMADI (APK
// dağıtılmadı) → migrasyon/geriye-uyum kodu yok; varsa artık okunmaz.
const TAMBUR_SHORT_CUT_A1_OVERRIDE_KEY = 'tambur_short_cut_a1_override';
const TAMBUR_SHORT_CUT_A1_DEVICE_THRESHOLD_KEY = 'tambur_short_cut_a1_device_threshold';

/** Metraj kaynağı: makineden oku (auto) ya da operatör elle girsin (manual). */
export type MeterEntryMode = 'manual' | 'auto';

/** Baskı kâğıdı boyu. */
export type DocPageSize = 'A4' | 'A5';

/** Barkod/QR okuyucunun kamera yönü. */
export type CameraFacing = 'front' | 'back';

/** Kısa kesim kuralının bu cihazdaki kaynağı — bkz. `tamburShortCutA1Override`. */
export type ShortCutOverrideMode = 'server' | 'on' | 'off';

interface DeviceSettingsState {
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
  setTamburResetQualityAfterCut: (v: boolean) => Promise<void>;
  setTamburResetKartelaAfterCut: (v: boolean) => Promise<void>;
  setTamburManualMode: (v: boolean) => Promise<void>;
  setScanSoundEnabled: (v: boolean) => Promise<void>;
  setDocPageSize: (docType: string, v: DocPageSize) => Promise<void>;
  setCameraFacing: (v: CameraFacing) => Promise<void>;
  setTamburShortCutA1Override: (v: ShortCutOverrideMode) => Promise<void>;
  setTamburShortCutA1DeviceThresholdM: (v: number | null) => Promise<void>;
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

export const useDeviceSettingsStore = create<DeviceSettingsState>((set) => ({
  manualBarcodeEntry: false,
  lastRouteTemplateId: null,
  kk1ManualEntry: false,
  tamburCutMode: 'manual',
  tamburResetQualityAfterCut: false,
  tamburResetKartelaAfterCut: true,
  tamburManualMode: false,
  tamburOutputCollapsed: false,
  scanSoundEnabled: true,
  docPageSize: {},
  cameraFacing: 'back',
  tamburShortCutA1Override: 'server',
  tamburShortCutA1DeviceThresholdM: null,
  isLoaded: false,

  init: async () => {
    const [stored, lastRoute, kk1Manual, tamburMode, tamburResetQuality, tamburResetKartela, tamburManual, scanSound, docSizes, outputCollapsed, cameraFacing, shortCutOverride, shortCutThreshold] =
      await Promise.all([
        storage.getItem(MANUAL_BARCODE_KEY),
        storage.getItem(LAST_ROUTE_KEY),
        storage.getItem(KK1_MANUAL_METER_KEY),
        storage.getItem(TAMBUR_CUT_MODE_KEY),
        storage.getItem(TAMBUR_RESET_QUALITY_KEY),
        storage.getItem(TAMBUR_RESET_KARTELA_KEY),
        storage.getItem(TAMBUR_MANUAL_MODE_KEY),
        storage.getItem(SCAN_SOUND_KEY),
        storage.getItem(DOC_PAGE_SIZE_KEY),
        storage.getItem(TAMBUR_OUTPUT_COLLAPSED_KEY),
        storage.getItem(CAMERA_FACING_KEY),
        storage.getItem(TAMBUR_SHORT_CUT_A1_OVERRIDE_KEY),
        storage.getItem(TAMBUR_SHORT_CUT_A1_DEVICE_THRESHOLD_KEY),
      ]);
    set({
      manualBarcodeEntry: stored === 'true',
      lastRouteTemplateId: lastRoute || null,
      kk1ManualEntry: kk1Manual === 'true',
      tamburOutputCollapsed: outputCollapsed === 'true',
      // Bilinmeyen/bozuk değer → varsayılan 'manual' (kayıt yoksa da öyle).
      tamburCutMode: tamburMode === 'auto' ? 'auto' : 'manual',
      // Varsayılan KAPALI (bugünkü davranış: kalite korunur) — yalnız birebir
      // 'true' sıfırlamayı açar.
      tamburResetQualityAfterCut: tamburResetQuality === 'true',
      // Varsayılan AÇIK → yalnız birebir 'false' yapışkanlığı geri getirir
      // (scanSoundEnabled ile aynı ters yön; güvenli taraf "sıfırla").
      tamburResetKartelaAfterCut: tamburResetKartela !== 'false',
      // Güvenli varsayılan KAPALI: yalnız birebir 'true' modu açar (bozuk değer
      // kart-atlayan modu sessizce açmasın).
      tamburManualMode: tamburManual === 'true',
      // Varsayılan AÇIK → yalnız birebir 'false' sesi kapatır. Diğer bayraklarla
      // ters yön: burada güvenli taraf "sinyal ver", "sessiz kal" değil.
      scanSoundEnabled: scanSound !== 'false',
      docPageSize: parseDocPageSizes(docSizes),
      // Yalnız birebir 'front' ön kamerayı açar; kayıt yok / bozuk değer →
      // 'back' (barkod okumanın güvenli tarafı: ön kamerayla okuyamayan bir
      // operatör "kamera bozuk" der, arka kamerayla okuyamayan yönü çevirir).
      cameraFacing: cameraFacing === 'front' ? 'front' : 'back',
      // Bilinmeyen/eksik değer → 'server' (fabrika ayarını izle). 'on'/'off'
      // AÇIK BEYANDIR; bozuk bir kayıt yüzünden cihaz sessizce fabrikadan
      // ayrılmaz. Eşik: pozitif sonlu sayı değilse null (kural inert).
      tamburShortCutA1Override:
        shortCutOverride === 'on' ? 'on' : shortCutOverride === 'off' ? 'off' : 'server',
      tamburShortCutA1DeviceThresholdM: (() => {
        const n = shortCutThreshold == null ? NaN : Number(shortCutThreshold);
        return Number.isFinite(n) && n > 0 ? n : null;
      })(),
      isLoaded: true,
    });
  },

  setManualBarcodeEntry: async (v) => {
    await storage.setItem(MANUAL_BARCODE_KEY, v ? 'true' : 'false');
    set({ manualBarcodeEntry: v });
  },

  setLastRouteTemplateId: async (v) => {
    if (v) await storage.setItem(LAST_ROUTE_KEY, v);
    else await storage.deleteItem(LAST_ROUTE_KEY);
    set({ lastRouteTemplateId: v });
  },

  // Ekrandaki anahtar ANINDA dönsün diye önce state, sonra disk (yazma hatası
  // arayüzü kilitlemez; en kötü ihtimalle tercih o cihazda kalıcı olmaz).
  setKk1ManualEntry: async (v) => {
    set({ kk1ManualEntry: v });
    await storage.setItem(KK1_MANUAL_METER_KEY, v ? 'true' : 'false');
  },

  setTamburOutputCollapsed: async (v) => {
    set({ tamburOutputCollapsed: v });
    await storage.setItem(TAMBUR_OUTPUT_COLLAPSED_KEY, String(v));
  },

  setTamburCutMode: async (v) => {
    set({ tamburCutMode: v });
    await storage.setItem(TAMBUR_CUT_MODE_KEY, v);
  },

  setTamburResetQualityAfterCut: async (v) => {
    set({ tamburResetQualityAfterCut: v });
    await storage.setItem(TAMBUR_RESET_QUALITY_KEY, v ? 'true' : 'false');
  },

  setTamburResetKartelaAfterCut: async (v) => {
    set({ tamburResetKartelaAfterCut: v });
    await storage.setItem(TAMBUR_RESET_KARTELA_KEY, v ? 'true' : 'false');
  },

  // Aynı desen (önce state, sonra disk): mod anahtarı ekranda ANINDA dönmeli —
  // operatör hangi moda geçtiğini beklemeden görmeli.
  setTamburManualMode: async (v) => {
    set({ tamburManualMode: v });
    await storage.setItem(TAMBUR_MANUAL_MODE_KEY, v ? 'true' : 'false');
  },

  setScanSoundEnabled: async (v) => {
    set({ scanSoundEnabled: v });
    await storage.setItem(SCAN_SOUND_KEY, v ? 'true' : 'false');
  },

  // Aynı desen: rozet ANINDA dönsün diye önce state, sonra disk.
  // Harita KOMPLE yazılır (tek anahtar) — belge tipi başına ayrı storage anahtarı
  // açmak, tip eklendikçe `init`in Promise.all listesini büyütürdü.
  setDocPageSize: async (docType, v) => {
    let next: Record<string, DocPageSize> = {};
    set((s) => {
      next = { ...s.docPageSize, [docType]: v };
      return { docPageSize: next };
    });
    await storage.setItem(DOC_PAGE_SIZE_KEY, JSON.stringify(next));
  },

  clearDocPageSize: async (docType) => {
    let next: Record<string, DocPageSize> = {};
    set((s) => {
      // Anahtarı `undefined` bırakmak yerine SİL: `JSON.stringify` undefined
      // değeri zaten atar, ama harita bellekte de temiz kalsın (`in` ile bakan
      // bir çağıran ileride yanılmasın).
      const { [docType]: _drop, ...rest } = s.docPageSize;
      next = rest;
      return { docPageSize: next };
    });
    await storage.setItem(DOC_PAGE_SIZE_KEY, JSON.stringify(next));
  },

  // Aynı desen: kamera ANINDA dönsün diye önce state, sonra disk.
  setCameraFacing: async (v) => {
    set({ cameraFacing: v });
    await storage.setItem(CAMERA_FACING_KEY, v);
  },

  setTamburShortCutA1Override: async (v) => {
    set({ tamburShortCutA1Override: v });
    await storage.setItem(TAMBUR_SHORT_CUT_A1_OVERRIDE_KEY, v);
  },

  // null/geçersiz → kayıt SİLİNİR (eşik girilmemiş durumuna döner). Override
  // 'server'a dönse bile cihaz eşiği SİLİNMEZ: operatör geçici olarak fabrikaya
  // dönüp geri geldiğinde "kaç metreydi?" diye hatırlamak zorunda kalmasın.
  setTamburShortCutA1DeviceThresholdM: async (v) => {
    const valid = v != null && Number.isFinite(v) && v > 0 ? v : null;
    set({ tamburShortCutA1DeviceThresholdM: valid });
    if (valid == null) await storage.deleteItem(TAMBUR_SHORT_CUT_A1_DEVICE_THRESHOLD_KEY);
    else await storage.setItem(TAMBUR_SHORT_CUT_A1_DEVICE_THRESHOLD_KEY, String(valid));
  },
}));

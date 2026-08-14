/**
 * Bu bilgisayara özel donanım ayarları — YEREL depo (secure-store), backend'deki
 * kullanıcı `UserPreference` blob'una DEĞİL.
 *
 * Etiket yazıcısı / sevkiyat kantarı / barkod tabancası fiziksel olarak BU
 * makineye bağlıdır (COM portu, CUPS kuyruğu, VID/PID). Bu yüzden ayarları
 * kullanıcıya değil makineye ait olmalı — aksi halde aynı hesapla başka bir
 * bilgisayara girildiğinde A makinesinin portu B'ye taşınır ve baskı/tartı
 * olmayan bir porta gider. Sunucu adresiyle (`@/lib/api-config`) aynı gerekçe,
 * aynı depo (`window.api.secureStore`, `safeStorage` ile şifreli, per-machine).
 *
 * NOT: Kişisel UI tercihleri (tema, favoriler, tablo düzeni…) bilerek burada
 * DEĞİL — onlar kullanıcıyı takip etmeli ve `UserPreference` blob'unda kalır
 * (`@/types/preferences`).
 */
import type { ScannerTransport, ScanTerminatorPref } from "@shared/ipc-contract";
import { secureStore } from "@/lib/secure-store";

/** secure-store anahtarı — tek JSON blob (sunucu adresiyle aynı şifreli store). */
const STORE_KEY = "config.workstation";

/**
 * Etiket yazıcısı (Argox) — bu iş istasyonuna özel. Açıkken etiket baskısı OS
 * yazdırma diyaloğu yerine seçili seri/COM porta ham PPLA gönderir.
 */
export interface LabelPrinterConfig {
  enabled?: boolean;
  /** "serial" = seri/COM (Windows sanal COM / USB-CDC); "cups" = macOS/Linux CUPS
   * kuyruğu; "winspool" = Windows yazıcı kuyruğu RAW passthrough (USB Argox/Bixolon —
   * USBPRINT-sınıfı, COM görünmez; "Generic/Text Only" kuyruğu yeterli, vendor sürücüsü
   * indirmeye gerek yok). Dil cihaz-başına peripheralId'den çözülür. */
  transport?: "serial" | "cups" | "winspool";
  /** serial: COM yolu (COM5 / /dev/tty.*); cups: CUPS kuyruk adı (lp -d);
   * winspool: Windows yazıcı kuyruğu adı. */
  path?: string;
  baudRate?: number;
  /** Cihaz Kaydı'ndaki LABEL_PRINTER id'si — dil/profil/şablon O CİHAZDAN çözülür. */
  peripheralId?: string;
}

/** Sevkiyat kantarı (seri/COM) — bu PC'ye USB/seri bağlı; okuma window.api.scale.read. */
export interface ScaleDeviceConfig {
  /** COM yolu (COM3 / /dev/tty.*). Boş = tanımsız. */
  path?: string;
  baudRate?: number;
  /** İstek-cevap komutu (boş = sürekli-yayın; ilk taze satır okunur). */
  pollCommand?: string;
  terminator?: string;
  timeoutMs?: number;
  /** Ondalık hassasiyeti (weight-codec; default 2). */
  decimals?: number;
  /** Ham → kg çarpanı (default 1). */
  factor?: number;
  // `simulate` KALDIRILDI (2026-07-30): bu PC'ye ait, DB'de KAYDI OLMAYAN bir
  // simülasyon anahtarıydı → backend onu GÖREMİYOR, dolayısıyla simüle kantar
  // korumasını (`shipping.simulatedWeightEnabled`) sunucu tarafından uygulayamıyordu
  // ve her sevkiyat bilgisayarını elle dolaşmak gerekiyordu. Kantar simülasyonu
  // artık TEK yerde yaşar: Tanımlar → Cihaz Kaydı (`PeripheralDevice.simulate`),
  // orası hem denetlenebilir hem audit'li hem de backend'in gördüğü yer.
  // Eski blob'larda kalan `simulate` alanı okunmaz (sessizce yok sayılır); yalnız
  // COM portu (`path`) tanımlı PC'ler yerel kantarı kullanmaya devam eder.
}

/** Seri/HID barkod tabancası (klavye-wedge YAPAMAYAN cihaz) — bu istasyona bağlı. */
export interface ScannerDeviceConfig {
  enabled?: boolean;
  transport?: ScannerTransport;
  path?: string;
  baudRate?: number;
  vendorId?: number;
  productId?: number;
  frameTerminator?: ScanTerminatorPref;
}

/**
 * Barkod tabancası ayarları — bu iş istasyonuna özel.
 * `scanAnywhere`: input odaklı değilken global "her yerde okut" yönlendirici.
 * Zamanlama alanları gerçek tabancaya göre ince ayar (genelde dokunulmaz).
 */
export interface ScannerConfig {
  scanAnywhere?: boolean;
  terminator?: "Enter" | "Tab" | "both";
  maxInterKeyMs?: number;
  minLength?: number;
  /** Faz-2 — seri/HID'e kilitli tabanca (opt-in). */
  device?: ScannerDeviceConfig;
}

/** Bu bilgisayara özel donanım ayarlarının tamamı (tek secure-store blob'u). */
export interface MachineConfig {
  labelPrinter?: LabelPrinterConfig;
  scaleDevice?: ScaleDeviceConfig;
  scanner?: ScannerConfig;
}

export const EMPTY_MACHINE_CONFIG: MachineConfig = {};

/** react-query anahtarı — makineye bağlı (kullanıcıya göre değişmez). */
export const MACHINE_CONFIG_QUERY_KEY = ["machine-config"] as const;

/**
 * Yerel kayıtlı donanım ayarları (yoksa/parse hatasında boş). Renderer'da
 * `window.api` yoksa (web/test) sessizce boş döner.
 */
export async function getStoredMachineConfig(): Promise<MachineConfig> {
  try {
    const raw = await secureStore.get(STORE_KEY);
    if (!raw) return EMPTY_MACHINE_CONFIG;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as MachineConfig;
    }
    return EMPTY_MACHINE_CONFIG;
  } catch {
    return EMPTY_MACHINE_CONFIG;
  }
}

/** Ayarları yerel olarak kaydet (tek JSON blob). */
export async function setStoredMachineConfig(config: MachineConfig): Promise<void> {
  await secureStore.set(STORE_KEY, JSON.stringify(config));
}

/** Kayıtlı donanım ayarlarını sil. */
export async function clearStoredMachineConfig(): Promise<void> {
  await secureStore.delete(STORE_KEY);
}

/**
 * Main ↔ renderer IPC kontratı.
 * - Yeni kanal eklerken: bu dosyaya tip ekle, electron/ipc/<domain>.ipc.ts'ye handler ekle,
 *   electron/preload.ts'ye bridge ekle. (electron-admin-page skill bu dört adımı atomik yapar.)
 * - Yalnız serializable veri geçer.
 */

// Keşif aday tipi saf mantık dosyasında yaşıyor (orada test edilebiliyor);
// burada yeniden tanımlamak iki kopya demek olurdu.
import type { DiscoveredServer } from "./discovery";

export type { DiscoveredServer };

export interface SecureStoreApi {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export type AppPlatform = "darwin" | "win32" | "linux" | "aix" | "freebsd" | "openbsd" | "sunos";

export interface AppInfoApi {
  version: () => Promise<string>;
  platform: () => AppPlatform;
}

export interface WindowApi {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
}

export interface SystemApi {
  openExternal: (url: string) => Promise<void>;
  showInFolder: (path: string) => void;
}

export interface PdfSaveOpts {
  /** Basılacak tam HTML belge (backend renderer çıktısı). */
  html: string;
  /** Kaydet dialoğunda önerilen dosya adı (.pdf uzantısı otomatik eklenir). */
  suggestedName: string;
}
export interface PdfSaveResult {
  saved: boolean;
  path?: string;
  error?: string;
}
export interface PdfBatchItem {
  /** Basılacak tam HTML belge. */
  html: string;
  /** Dosya adı (.pdf otomatik eklenir) — sevk no vb. benzersiz. */
  name: string;
}
export interface PdfSaveBatchOpts {
  items: PdfBatchItem[];
}
/** Toplu klasör-kaydı sonucu (PDF veya dosya). */
export interface SaveBatchResult {
  saved: boolean;
  /** Yazılan klasör. */
  dir?: string;
  /** Yazılan dosya sayısı. */
  count?: number;
  error?: string;
}
export interface PdfApi {
  /** HTML belgeyi gizli pencerede PDF'e çevirir + kaydet dialoğuyla diske yazar. */
  save: (opts: PdfSaveOpts) => Promise<PdfSaveResult>;
  /** N belgeyi seçilen KLASÖRE ayrı ayrı PDF olarak yazar (her biri <name>.pdf). */
  saveBatch: (opts: PdfSaveBatchOpts) => Promise<SaveBatchResult>;
}

export interface FilesBatchItem {
  /** Dosya adı — UZANTI DAHİL (ör. "SVK-2026-0042.xlsx"). */
  name: string;
  /** İçerik, base64. */
  base64: string;
}
export interface FilesSaveBatchOpts {
  items: FilesBatchItem[];
}
export interface FileSaveOpts {
  /** Önerilen dosya adı — UZANTI DAHİL (ör. "Sevkiyatlar.xlsx"). */
  name: string;
  base64: string;
}
export interface FileSaveResult {
  saved: boolean;
  path?: string;
  error?: string;
}
export interface FilesApi {
  /** Tek dosyayı KAYDET DİALOĞUYLA yazar (pencereye bağlı → arka plan kararır; kullanıcı
   *  onaylayınca döner). Excel indirmeleri bununla → toast doğru zamanda + karartma var. */
  save: (opts: FileSaveOpts) => Promise<FileSaveResult>;
  /** Renderer'ın ürettiği dosyaları (base64) seçilen KLASÖRE yazar (ör. toplu Excel). */
  saveBatch: (opts: FilesSaveBatchOpts) => Promise<SaveBatchResult>;
}

export interface PowerApi {
  /** Sistem-geneli boşta kalma süresi (saniye) — Electron powerMonitor.getSystemIdleTime().
   *  Yalnız Electron penceresi değil, TÜM bilgisayarın son fare/klavye girdisinden bu
   *  yana geçen süre. Hareketsizlik (idle) çıkışı bunu periyodik okur. */
  getSystemIdleTime: () => Promise<number>;
}

// ===========================================================================
// Faz-2: seri/HID barkod tabancası (klavye-wedge YAPAMAYAN cihazlar)
// Native modüller (serialport/node-hid) yalnız MAIN'de yüklenir; renderer
// `window.api.scanner` köprüsüyle konuşur. Aynı `pushScan` boru hattını besler.
// ===========================================================================

export type ScannerTransport = "serial" | "hid" | "mock";
export type ScanTerminatorPref = "lf" | "cr" | "crlf" | "none";

export interface ScannerDeviceInfo {
  path: string;
  label: string;
  vendorId?: number;
  productId?: number;
}

export interface ScannerListResult {
  /** Bu taşıma için native modül yüklü + Electron ABI'sine derli mi? */
  available: boolean;
  error: string | null;
  devices: ScannerDeviceInfo[];
}

export interface ScannerOpenOpts {
  transport: ScannerTransport;
  path: string;
  baudRate?: number; // serial (default 9600)
  vendorId?: number; // hid (path yerine vid/pid ile de açılabilir)
  productId?: number;
  terminator?: ScanTerminatorPref; // default "lf"
}

export interface ScannerStatus {
  connected: boolean;
  transport: ScannerTransport | null;
  path: string | null;
  error: string | null;
}

export interface ScannerDeviceApi {
  /** Taşıma için modül durumu + cihaz listesi. */
  list: (transport: ScannerTransport) => Promise<ScannerListResult>;
  open: (opts: ScannerOpenOpts) => Promise<ScannerStatus>;
  close: () => Promise<ScannerStatus>;
  status: () => Promise<ScannerStatus>;
  /** Donanım olmadan boru hattını test etmek için sahte kod enjekte et. */
  mockEmit: (code: string) => void;
  /** Taranan kod geldikçe. Unsubscribe fonksiyonu döner. */
  onData: (cb: (code: string) => void) => () => void;
  /** Bağlantı durumu değişince. Unsubscribe fonksiyonu döner. */
  onStatus: (cb: (status: ScannerStatus) => void) => () => void;
}

// --- Native yazıcı transport (seri/COM + ağ TCP 9100 + macOS CUPS + Windows spooler RAW) ---
export interface PrinterSendOpts {
  transport: "tcp" | "serial" | "cups" | "winspool";
  /** TCP: IP/host; serial: COM yolu; cups: CUPS kuyruk adı (lp -d);
   *  winspool: Windows yazıcı kuyruğu adı (USB Argox/Bixolon — RAW passthrough). */
  target: string;
  /** TCP portu (default 9100). */
  port?: number;
  /** serial baud (default 9600). */
  baudRate?: number;
  /** Gönderilecek native komut (PPLA/PPLB/ZPL) — latin1 bayt-bire-bir. content ve
   *  contentB64'ten TAM BİRİ verilir (content = eski komut yolu). */
  content?: string;
  /** Raster/binary yük — base64 (1bpp bitmap zarfı). main'de decode edilip ham gönderilir. */
  contentB64?: string;
}
export interface PrinterSendResult {
  ok: boolean;
  bytes: number;
  /** Native modül mevcut mu (serialport derlenmemişse false; uygulama çökmez). */
  available: boolean;
  error: string | null;
}
export interface PrinterTransportApi {
  /** Seri (COM) cihaz listesi — modül durumu + cihazlar (BT-COM dahil). */
  listSerial: () => Promise<ScannerListResult>;
  /** macOS/Linux CUPS kuyrukları (lpstat -e) — her cihaz path=kuyruk adı.
   * Windows'ta lp/lpstat yok → available:false (graceful). */
  listCups: () => Promise<ScannerListResult>;
  /** Windows kurulu yazıcı kuyrukları (Win32_Printer) — her cihaz path=kuyruk adı.
   * Windows dışında powershell.exe yok → available:false (graceful). */
  listWinspool: () => Promise<ScannerListResult>;
  /** Native komutu seri/TCP/CUPS/Windows-spooler yazıcıya gönder. Modül yoksa available:false. */
  send: (opts: PrinterSendOpts) => Promise<PrinterSendResult>;
}

// --- Kantar (SCALE) seri okuma: yaz-sonra-oku round-trip (HC-06 → COM portu) ---
// Sevkiyat PC'sinde çuval brüt tartısı. Mobil HAL `readResponse` deseninin
// Electron/seri eşdeğeri: pollCommand yaz → terminator'a kadar oku → ham döndür
// (renderer `weight-codec` ile çözer).
export interface ScaleReadOpts {
  /** COM yolu (örn "COM3"). */
  path: string;
  /** serial baud (default 9600). */
  baudRate?: number;
  /** İstek-cevap kantar komutu (boş = sürekli-yayın; ilk taze satır okunur). */
  pollCommand?: string;
  /** Yanıt satır sonu (örn "\r\n"); boş → herhangi CR/LF. */
  terminator?: string;
  /** Okuma zaman aşımı ms (default 2500). */
  timeoutMs?: number;
}
export interface ScaleReadResult {
  ok: boolean;
  /** Native modül (serialport) yüklü mü? Derlenmemişse false (uygulama çökmez). */
  available: boolean;
  /** Ham yanıt (renderer codec ile çözer). */
  raw?: string;
  error: string | null;
}
export interface ScaleApi {
  /** Kantardan tek okuma (yaz-sonra-oku). Modül yoksa available:false. */
  read: (opts: ScaleReadOpts) => Promise<ScaleReadResult>;
}

// --- Otomatik güncelleme (electron-updater) ---
// Kurulu uygulama, yayın adresindeki `latest.yml`e bakıp yeni sürüm varsa arka
// planda indirir; kurulum kullanıcı "Yeniden Başlat" dediğinde yapılır.
// ⚠️ Yalnız PAKETLENMİŞ uygulamada çalışır — `npm run dev`de `enabled:false`dır
// (electron-updater paketlenmemiş uygulamada hata fırlatır, bu yüzden hiç çağrılmaz).

export type UpdateState =
  /** Henüz kontrol edilmedi (açılışın ilk saniyeleri) ya da dev modu. */
  | "idle"
  /** Sunucuya soruluyor. */
  | "checking"
  /** Kurulu sürüm en güncel. */
  | "up-to-date"
  /** Yeni sürüm bulundu, indirme başlıyor. */
  | "available"
  /** İniyor (`percent`). */
  | "downloading"
  /** İndi — yeniden başlatınca kurulacak. */
  | "ready"
  /** Sunucuya ulaşılamadı / indirme düştü (`error`). */
  | "error";

export interface UpdateStatus {
  state: UpdateState;
  /** Şu an çalışan sürüm. */
  currentVersion: string;
  /** Bulunan yeni sürüm — yalnız available/downloading/ready durumlarında. */
  newVersion?: string;
  /** İndirme yüzdesi 0-100 — yalnız downloading. */
  percent?: number;
  /** Kullanıcıya gösterilecek Türkçe hata — yalnız error. */
  error?: string;
  /** Son BAŞARILI kontrolün zamanı (ISO). Hiç kontrol edilmediyse null. */
  lastCheckedAt: string | null;
  /** Güncellemenin arandığı adres (teşhis için Ayarlar'da gösterilir). */
  feedUrl: string;
  /** Adres bu makinede elle ezilmiş mi (varsayılan değil). */
  feedUrlOverridden: boolean;
  /** Paketlenmiş uygulama mı — false ise güncelleme hiç denenmez. */
  enabled: boolean;
}

export interface UpdaterApi {
  /** Anlık durum — ekran ilk açıldığında okunur. */
  status: () => Promise<UpdateStatus>;
  /** "Şimdi kontrol et". Zaten indirilmiş güncelleme varsa dokunmaz. */
  check: () => Promise<UpdateStatus>;
  /** İndirilen sürümü kurup uygulamayı yeniden başlatır (yalnız state=ready). */
  install: () => void;
  /** Bu makinenin yayın adresini ez / varsayılana döndür (null = varsayılan). */
  setFeedUrl: (url: string | null) => Promise<UpdateStatus>;
  /** Durum değiştikçe haber verir. Unsubscribe fonksiyonu döner. */
  onStatus: (cb: (status: UpdateStatus) => void) => () => void;
}

// ---------------------------------------------------------------------------
// Sunucu keşfi
// ---------------------------------------------------------------------------

export type DiscoveryStatus = "idle" | "running" | "done" | "error";

export interface DiscoveryState {
  status: DiscoveryStatus;
  startedAt: number | null;
  finishedAt: number | null;
  /** Sıralı: en iyi aday ilk (bkz. shared/discovery.ts → rankCandidates). */
  candidates: DiscoveredServer[];
  /** main otomatik uyguladıysa dolu — renderer bunu kullanıcıya bildirir. */
  applied: { baseUrl: string; reason: "single" | "pin-moved" } | null;
  mdns: { available: boolean; error: string | null; hits: number };
  /** `skippedReason` dolu = tarama BİLEREK koşmadı (gürültü emniyeti). */
  scan: { ran: boolean; targets: number; open: number; skippedReason: string | null };
  pinnedInstallationId: string | null;
  error: string | null;
}

export interface DiscoveryApi {
  /** O anki durum. ⚠️ PULL: push kanalı BİLEREK yok (splash→renderer geçişi listener'ları düşürür). */
  state: () => Promise<DiscoveryState>;
  /** Yeni bir keşif turu başlatır; koşan tur varsa onu döner. */
  start: (opts?: { timeoutMs?: number }) => Promise<DiscoveryState>;
  /** Tek bir adresi doğrular (Ayarlar'daki "Bağlantıyı Test Et"). */
  probe: (baseUrl: string) => Promise<DiscoveredServer | null>;
  /** Sunucu kimliğini bu makineye sabitler (null = sabitlemeyi kaldır). */
  pin: (installationId: string | null) => Promise<void>;
}

export interface ApiBridge {
  secureStore: SecureStoreApi;
  discovery: DiscoveryApi;
  appInfo: AppInfoApi;
  window: WindowApi;
  system: SystemApi;
  power: PowerApi;
  scanner: ScannerDeviceApi;
  printer: PrinterTransportApi;
  scale: ScaleApi;
  pdf: PdfApi;
  files: FilesApi;
  updater: UpdaterApi;
}

declare global {
  interface Window {
    api: ApiBridge;
  }
}

export {};

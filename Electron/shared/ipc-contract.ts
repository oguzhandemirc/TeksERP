/**
 * Main ↔ renderer IPC kontratı.
 * - Yeni kanal eklerken: bu dosyaya tip ekle, electron/ipc/<domain>.ipc.ts'ye handler ekle,
 *   electron/preload.ts'ye bridge ekle. (electron-admin-page skill bu dört adımı atomik yapar.)
 * - Yalnız serializable veri geçer.
 */

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

// --- Native yazıcı transport (Faz-2: seri/COM + ağ TCP 9100 + macOS CUPS) ---
export interface PrinterSendOpts {
  transport: "tcp" | "serial" | "cups";
  /** TCP: IP/host; serial: COM yolu; cups: CUPS kuyruk adı (lp -d). */
  target: string;
  /** TCP portu (default 9100). */
  port?: number;
  /** serial baud (default 9600). */
  baudRate?: number;
  /** Gönderilecek native komut (PPLA/PPLB/ZPL). latin1 bayt-bire-bir yazılır. */
  content: string;
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
  /** Native komutu seri/TCP/CUPS yazıcıya gönder. Modül yoksa available:false. */
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

export interface ApiBridge {
  secureStore: SecureStoreApi;
  appInfo: AppInfoApi;
  window: WindowApi;
  system: SystemApi;
  power: PowerApi;
  scanner: ScannerDeviceApi;
  printer: PrinterTransportApi;
  scale: ScaleApi;
}

declare global {
  interface Window {
    api: ApiBridge;
  }
}

export {};

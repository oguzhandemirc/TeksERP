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

export interface ApiBridge {
  secureStore: SecureStoreApi;
  appInfo: AppInfoApi;
  window: WindowApi;
  system: SystemApi;
  scanner: ScannerDeviceApi;
}

declare global {
  interface Window {
    api: ApiBridge;
  }
}

export {};
